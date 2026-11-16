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
