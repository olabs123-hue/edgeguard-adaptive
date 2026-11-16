/** Private synthetic origins. Deploy with workers_dev=false and service bindings only. */
interface Env { ORIGIN_ID?: string }
const safeHeaders = { 'content-type': 'application/json', 'cache-control': 'no-store' };
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = env.ORIGIN_ID === 'b' ? 'b' : 'a';
    if (!['GET','HEAD'].includes(request.method))
      return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
    if (url.pathname === '/healthz')
      return new Response('ok', { status: 200, headers: { 'cache-control':'no-store' } });
    // Explicit deterministic failure-injection scenarios, with no arbitrary target fetching.
    if (url.pathname === '/demo/fail' && origin === 'a')
      return new Response(JSON.stringify({ origin, scenario:'injected_503' }),
        { status:503, headers:safeHeaders });
    if (url.pathname === '/demo/slow' && origin === 'a')
      await new Promise(resolve => setTimeout(resolve, 250));
    if (url.pathname === '/demo/ok' || url.pathname === '/demo/fail' ||
        url.pathname === '/demo/slow')
      return new Response(JSON.stringify({ origin, scenario:url.pathname.slice(6), ok:true }),
        { status:200, headers:{...safeHeaders,'x-fixture-origin':origin} });
    return new Response(JSON.stringify({error:'not_found'}),
      { status:404, headers:safeHeaders });
  }
};
