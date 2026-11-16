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

You may first run the [manual GitHub Actions deploy-private-origins workflow](../.github/workflows/deploy-private-origins.yml). It uses your existing GitHub repository Cloudflare deployment secrets, runs fixture tests, verifies `workers_dev = false` in both configs, and deploys only the two private fixtures. The public EdgeGuard Worker is **not** changed by this workflow.

Or use Wrangler locally as below.

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

## Deploy the authenticated connected demonstration from GitHub Actions

A separate [Deploy connected failover demo](../.github/workflows/deploy-connected-demo.yml) workflow will activate service bindings **only when you run it manually**. The fixture deployment workflow does not activate these bindings.

1. Generate a random, independent demo bearer secret with at least 32 characters, for example `openssl rand -hex 32`. Do **not** reuse your Cloudflare account API token or put the value in source code, chat messages or screenshots.
2. Add it under GitHub → Settings → Secrets and variables → Actions → **New repository secret**, with name `EDGEGUARD_DEMO_BEARER_TOKEN`. Keep the existing `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets.
3. Run [Deploy connected failover demo](../.github/workflows/deploy-connected-demo.yml) manually on `main`. It runs validation, switches the Worker to the opted-in private service-binding profile, and sets the **separate** Worker `API_TOKEN` application secret.
4. Verify that `GET /demo/ok` without authorization returns **401**. For authenticated testing, use a local shell rather than a screenshot:
   `curl -i -H "Authorization: Bearer $EDGEGUARD_DEMO_BEARER_TOKEN" https://edgeguard-adaptive.olabosoyeolamide123.workers.dev/demo/fail`
5. A successful response is expected to come from origin B after A returns an injected 503, but the result must be observed from the deployed account to claim this as validated.

The workflow changes the live Worker **only on an explicit manual run**. The existing public health route remains unauthenticated, while origin routes require the app token. The app token is different from the Cloudflare deployment API token.

To restore fail-closed public-demo configuration, use the original [Deploy Cloudflare Worker](../.github/workflows/deploy-cloudflare.yml) workflow.

## Phase 3: Per-request attempt evidence

Authenticated proxy responses now include `x-edgeguard-attempt-trace`, `x-edgeguard-attempt-count` and `x-edgeguard-total-ms` headers. The trace records the origin alias, observed status/error and elapsed milliseconds for each attempt **within one request**. Backend hostnames and bearer tokens are not emitted.

Example of a conclusively observed failover:

```text
x-edgeguard-attempt-trace: origin-a:503:12ms,origin-b:200:4ms
x-edgeguard-attempt-count: 2
x-edgeguard-total-ms: 17
```

An actual header containing only `origin-b:200:...` proves successful origin B routing but **not** A-to-B failover on that request. Routing state is isolate-local and scoring may prefer B. Exact millisecond values vary; do not present illustrative numbers as measured results.

The [Live Worker smoke test](../.github/workflows/live-smoke-test.yml) validates the deployed Worker and captures its attempt trace without printing the bearer secret. A connected Worker deployment must run after source changes before these headers exist on the live site. Tracing adds diagnostic headers only on authenticated proxy responses and is not a production tracing system or a distributed telemetry store.
