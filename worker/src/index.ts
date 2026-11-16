/** Experimental Cloudflare Worker. All circuit state is isolate-local. */
export interface ServiceFetcher { fetch(request: Request): Promise<Response> }
export interface Env {
  ORIGIN_URLS: string;
  ORIGIN_A?: ServiceFetcher; // optional Cloudflare service binding
  ORIGIN_B?: ServiceFetcher; // optional Cloudflare service binding
  EVENT_QUEUE?: Queue<FailureEvent>;
  API_TOKEN?: string; // Cloudflare secret: never set in wrangler.toml
}
export interface FailureEvent {
  version: 1;
  eventId: string;
  timestamp: string;
  type: 'origin_attempt_failure' | 'origin_failure' | 'origin_recovery';
  origin: string;
  requestId: string;
  status?: number;
}
export interface Queue<T> { send(message: T): Promise<void> }
export interface BatchMessage<T> { body: T; ack(): void; retry(): void }
export interface MessageBatch<T> { messages: BatchMessage<T>[] }
interface OriginState {
  failures: number;
  openUntil: number;
  halfOpen: boolean;
  probeInFlight: boolean;
  latencyMs: number;
}
const state = new Map<string, OriginState>();
const FAILURE_THRESHOLD = 3;
const OPEN_MS = 5000;
const TIMEOUT_MS = 2000;
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function originState(origin: string): OriginState {
  let entry = state.get(origin);
  if (!entry) {
    entry = { failures: 0, openUntil: 0, halfOpen: false, probeInFlight: false, latencyMs: 0 };
    state.set(origin, entry);
  }
  return entry;
}

function configuredOrigins(env: Env): string[] {
  // Deploy both private origin workers and bind them explicitly to opt in.
  // The public demo remains disabled by default.
  if (!env.ORIGIN_URLS?.trim() && env.ORIGIN_A && env.ORIGIN_B)
    return ['binding:origin-a', 'binding:origin-b'];
  const raw = (env.ORIGIN_URLS || '').split(',').map(v => v.trim()).filter(Boolean);
  if (!raw.length) return [];
  const result: string[] = [];
  for (const item of raw) {
    const parsed = new URL(item);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
        parsed.search || parsed.hash || parsed.pathname !== '/')
      throw new Error('Invalid origin configuration: HTTPS origin roots only');
    const origin = parsed.origin;
    if (!result.includes(origin)) result.push(origin);
  }
  return result;
}

function selectOrigin(urls: string[], excluded: Set<string>, now: number): string | undefined {
  return urls.filter(origin => {
    if (excluded.has(origin)) return false;
    const s = originState(origin);
    if (s.openUntil > now) return false;
    if (s.openUntil) {
      s.halfOpen = true;
      s.openUntil = 0;
    }
    return !(s.halfOpen && s.probeInFlight);
  }).sort((a, b) => {
    const score = (origin: string) => {
      const s = originState(origin);
      // Favor a recovery probe after cooldown.
      return (s.halfOpen ? -1 : 0) + s.failures * 1000 + s.latencyMs;
    };
    return score(a) - score(b);
  })[0];
}

async function publish(env: Env, event: FailureEvent): Promise<void> {
  if (!env.EVENT_QUEUE) return;
  try { await env.EVENT_QUEUE.send(event); }
  catch (error) { console.error('Queue event publish failed', error); }
}

async function proxy(request: Request, env: Env, requestId: string, urls: string[]): Promise<Response> {
  const excluded = new Set<string>();
  // Diagnostic trace is scoped to authenticated requests and private fixture aliases.
  // Never publish real backend hostnames or authentication credentials.
  const trace: string[] = [];
  const startedRequest = Date.now();
  const attempts = Math.min(2, urls.length);
  for (let i = 0; i < attempts; ++i) {
    const origin = selectOrigin(urls, excluded, Date.now());
    if (!origin) break;
    excluded.add(origin);
    const s = originState(origin);
    if (s.halfOpen) s.probeInFlight = true;
    const incoming = new URL(request.url);
    const binding = origin === 'binding:origin-a' ? env.ORIGIN_A
      : origin === 'binding:origin-b' ? env.ORIGIN_B : undefined;
    const target = new URL(incoming.pathname + incoming.search,
      binding ? 'https://private-origin.invalid' : origin);
    const started = Date.now();
    const label = origin === 'binding:origin-a' ? 'origin-a'
      : origin === 'binding:origin-b' ? 'origin-b' : 'external-origin';
    let status: number | undefined;
    try {
      // Do not forward caller credentials or arbitrary hop-by-hop headers.
      const headers = new Headers();
      for (const name of ['accept', 'accept-language']) {
        const value = request.headers.get(name);
        if (value) headers.set(name, value);
      }
      headers.set('x-edgeguard-request-id', requestId);
      const forward = new Request(target, {
        method: request.method,
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const response = await (binding ? binding.fetch(forward) : fetch(forward));
      status = response.status;
      if (status >= 500) throw new Error('upstream_5xx');
      const elapsed = Date.now() - started;
      trace.push(label + ':' + response.status + ':' + elapsed + 'ms');
      s.latencyMs = s.latencyMs ? 0.7 * s.latencyMs + 0.3 * elapsed : elapsed;
      const recovering = s.halfOpen;
      s.failures = 0;
      s.halfOpen = false;
      s.probeInFlight = false;
      if (recovering) await publish(env, {
        version: 1, eventId: crypto.randomUUID(), timestamp: new Date().toISOString(),
        type: 'origin_recovery', origin, requestId
      });
      const result = new Response(response.body, response);
      result.headers.set('x-edgeguard-request-id', requestId);
      result.headers.set('x-edgeguard-origin', binding ? origin.slice(8) : new URL(origin).hostname);
      result.headers.set('cache-control', 'no-store');
      result.headers.set('x-edgeguard-attempt-trace', trace.join(','));
      result.headers.set('x-edgeguard-attempt-count', String(trace.length));
      result.headers.set('x-edgeguard-total-ms', String(Date.now() - startedRequest));
      return result;
    } catch (_error) {
      trace.push(label + ':' + (status === undefined ? 'network-error' : String(status))
        + ':' + (Date.now() - started) + 'ms');
      // Emit only sanitized fixture aliases, not third-party hostname, request body, URL or auth.
      if ((label === 'origin-a' || label === 'origin-b') && status !== undefined) {
        await publish(env, {
          version: 1, eventId: crypto.randomUUID(),
          timestamp: new Date().toISOString(), type: 'origin_attempt_failure',
          origin: label, requestId, status
        });
      }
      s.probeInFlight = false;
      s.halfOpen = false;
      s.failures++;
      if (s.failures >= FAILURE_THRESHOLD) {
        s.openUntil = Date.now() + OPEN_MS;
        if (s.failures === FAILURE_THRESHOLD)
          await publish(env, {
            version: 1, eventId: crypto.randomUUID(), timestamp: new Date().toISOString(),
            type: 'origin_failure', origin, requestId, ...(status ? {status} : {})
          });
      }
    }
  }
  return new Response(JSON.stringify({error:'no_available_origin',requestId}),
    {status:503,headers:{...JSON_HEADERS,'x-edgeguard-request-id':requestId,
      'x-edgeguard-attempt-trace':trace.join(','),
      'x-edgeguard-attempt-count':String(trace.length),
      'x-edgeguard-total-ms':String(Date.now()-startedRequest)}});
}

export const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/healthz') return new Response('ok', {headers:{'cache-control':'no-store'}});
    if (url.pathname === '/') return new Response(JSON.stringify({
      project:'EdgeGuard Adaptive', status:'prototype', health:'/healthz',
      message:'Origin forwarding disabled by default; this is an experimental Worker.'
    }), {headers:JSON_HEADERS});
    if (!['GET', 'HEAD'].includes(request.method))
      return new Response('Method not allowed', {status:405,headers:{allow:'GET, HEAD'}});
    if (!env.ORIGIN_URLS?.trim() && !(env.ORIGIN_A && env.ORIGIN_B))
      return new Response(JSON.stringify({error:'origins_not_configured'}),
        {status:503,headers:JSON_HEADERS});
    // Fail closed: a public Worker must not become an unauthenticated fetch proxy.
    if (!env.API_TOKEN || request.headers.get('authorization') !== 'Bearer ' + env.API_TOKEN)
      return new Response('Unauthorized', {status:401,headers:{'cache-control':'no-store'}});
    let urls: string[];
    try { urls = configuredOrigins(env); }
    catch (_) { return new Response('Invalid origin configuration', {status:503}); }
    const requestId = crypto.randomUUID();
    // No coalescing of responses until strict per-request privacy and Cache-Control
    // semantics can be enforced. Avoid cross-user response sharing by design.
    return proxy(request, env, requestId, urls);
  },
  async queue(batch: MessageBatch<FailureEvent>, _env: Env): Promise<void> {
    for (const message of batch.messages) {
      const e = message.body;
      if (!e || e.version !== 1 || typeof e.eventId !== 'string' ||
          !['origin_attempt_failure','origin_failure','origin_recovery'].includes(e.type) ||
          typeof e.origin !== 'string' || typeof e.requestId !== 'string') {
        console.error('Invalid reliability event; acknowledged');
        message.ack();
        continue;
      }
      try {
        console.log(JSON.stringify({kind:'edgeguard_reliability_event',
          eventId:e.eventId,type:e.type,origin:e.origin,timestamp:e.timestamp}));
        message.ack();
      } catch (_) {
        message.retry();
      }
    }
  }
};
export default worker;
