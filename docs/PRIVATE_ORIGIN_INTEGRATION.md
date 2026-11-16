# Phase 2: Private synthetic origin failover

This phase adds **two independent Cloudflare origin fixture Workers**. They are reachable only through **Cloudflare Worker service bindings**, not publicly over workers.dev.

- `edgeguard-origin-a`: `/demo/fail` returns 503; `/demo/slow` waits ~250 ms
- `edgeguard-origin-b`: same routes return 200 without injected delay
- Both respond to `/healthz` and `/demo/ok`
- There is no arbitrary external fetching, storage, request body handling or user-supplied target URL.

## Safety and deployment status

**Code and CI tests exist; the private fixture Workers are not automatically deployed.**
The default public EdgeGuard deployment still has `ORIGIN_URLS = ""` and no service bindings, so forwarding remains disabled. The `wrangler.connected.example.toml` profile is explicitly opt-in.

## Step-by-step activation (requires account owner authorization)

From the repository checkout:

```bash
cd origin-fixture
npm install
npm run typecheck
npm test
npx wrangler deploy --config wrangler.a.toml
npx wrangler deploy --config wrangler.b.toml
```

These Worker configs set `workers_dev = false`; verify in Cloudflare that they have no public routes. Then set an **independent secret** for the public edge Worker, for example with `cd ../worker && npx wrangler secret put API_TOKEN`. This secret is **not** the Cloudflare deployment API token and must not be exposed or committed.

**Before** opting into the connected profile, use the Cloudflare Access or another appropriate mechanism to restrict callers. With an authenticated edge request, `GET /demo/fail` can fail over from private origin A to private origin B. The edge Worker strips incoming Authorization and Cookie headers before forwarding.

```bash
cd ../worker
npx wrangler deploy --config wrangler.connected.example.toml
```

Because Worker service bindings are regional/runtime-isolate scoped in this prototype, circuit state is not shared across isolates. The fixture Workers are synthetic, not real backend processes. No global traffic-routing or production reliability claim is supported by these tests.

## Expected validation

- `GET /healthz` returns `ok` without authorization, as a minimal liveness endpoint.
- Without a bearer token, `GET /demo/ok` returns 401.
- With bearer token, `GET /demo/ok` returns 200 and `x-edgeguard-origin` identifies a fixture.
- `GET /demo/fail` should return 200 via origin B when A is selected first (per-isolate routing score and recent outcomes can affect selection).
- `GET /demo/slow` exercises a slower origin A; repeat requests to observe score changes.

Avoid including bearer tokens in committed scripts, screenshots or issue reports. Restore the default `wrangler.toml` via the normal deployment workflow to disable origin forwarding again.
