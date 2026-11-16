# EdgeGuard Adaptive — Edge Traffic & Reliability Platform

Standalone experimental edge reliability platform, independent from [the original C++/Pingora EdgeGuard proxy](https://github.com/olabs123-hue/Proxy).

**Components:** C++17 latency-aware routing policy with circuit breakers; TypeScript Cloudflare Worker providing bounded safe-method failover, per-isolate health state and optional Queue event hooks; Linux CI.

**Security:** The Worker launches as a public, read-only project description and health endpoint, with **origin forwarding disabled** by default. When origins are configured, a secret `API_TOKEN` is required; never put that token in `wrangler.toml`. This prototype is not a production CDN.

## Build and test

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug
cmake --build build -j 2
ctest --test-dir build --output-on-failure

cd worker
npm install
npm run typecheck
npm test
npx wrangler login
npx wrangler deploy
```

The deployment publishes the **Worker demo only**, not the C++ routing engine or a publicly exposed reverse proxy. See [deployment instructions](docs/LIVE_DEPLOYMENT.md) and [architecture](docs/ARCHITECTURE.md). Enable Cloudflare Queues only after creating the named queues in your account.

## Current limitations

C++ and TypeScript implementations are **separate** and do not share routing state. Worker circuit states are isolate-local, Queue processing is telemetry-only without durable deduplication, and caching is not implemented. GET/HEAD are the only proxy methods. There is no claimed public deployment, production SLA, or measured end-to-end benchmark.

## Phase 2: Private synthetic origins (optional, not yet activated)

Two deterministic Cloudflare Workers under `origin-fixture/` reproduce a healthy upstream and injected 503/latency scenarios. Both have `workers_dev = false`; no public routes are configured. The edge Worker now supports optional `ORIGIN_A` / `ORIGIN_B` Cloudflare service bindings, but the **normal production configuration remains fail-closed**.

See [private origin integration instructions](docs/PRIVATE_ORIGIN_INTEGRATION.md). A [manual private fixture deployment workflow](.github/workflows/deploy-private-origins.yml) is available after GitHub Actions secrets are configured. The private fixtures are separate from the original C++17 routing engine, which remains a local policy implementation.

## Live measured evidence

A [verified low-rate synthetic live benchmark](benchmarks/LIVE_RESULTS_2026-11-16.md) recorded **80/80 successful responses** at a deliberately paced **4 req/s** (40 healthy-scenario and 40 synthetic-failure-scenario requests). The client-observed p99 latencies were **186.61 ms** and **159.67 ms**, respectively. This is **not** a max-capacity test or proof of per-request A→B recovery. [Raw workflow evidence](https://github.com/olabs123-hue/edgeguard-adaptive/actions/runs/43979254617).

### Three-trial live measurements

[Repeated synthetic benchmark](benchmarks/LIVE_THREE_TRIAL_2026-11-16.md): **240/240 HTTP 200 responses** at a deliberately controlled **4 req/s per scenario** across three sequential trials. Median **trial** p99 latency was **154.35 ms** (healthy route) and **137.69 ms** (synthetic failure route). The figures do **not** represent maximum throughput, production availability or verified per-request A-to-B recovery. [GitHub Actions run](https://github.com/olabs123-hue/edgeguard-adaptive/actions/runs/43980181675).

### Repeatable live A→B retry evidence

A [three-trial live trace experiment](benchmarks/LIVE_REPEATED_FAILOVER_2026-11-16.md) observed **60/60 HTTP 200 responses**, with **12 verified same-request A503→B200 retries** and **43 ms median Worker-reported request duration across those 12 paired traces**. The remaining requests must not be counted as observed retries. This is synthetic, low-rate evidence and **not** circuit recovery time or production SLA. [Workflow logs](https://github.com/olabs123-hue/edgeguard-adaptive/actions/runs/43981537851).
