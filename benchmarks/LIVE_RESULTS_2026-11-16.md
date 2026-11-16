# Verified live synthetic performance sample — 16 November 2026 (UTC)

## Evidence

- [Successful GitHub Actions benchmark run](https://github.com/olabs123-hue/edgeguard-adaptive/actions/runs/43979254617)
- [Raw summary JSON artifact](https://github.com/olabs123-hue/edgeguard-adaptive/actions/runs/43979254617/artifacts/14282281847)
- Script: [benchmarks/live_sample.py](./live_sample.py)
- Target: https://edgeguard-adaptive.olabosoyeolamide123.workers.dev
- Source: GitHub-hosted Ubuntu runner. The test used a private bearer token from GitHub Actions secrets; the value was not printed.

## Method

The benchmark ran two **synthetic** scenarios, with one warm-up call then 40 measured HTTP requests per scenario. Request arrivals were paced to 4 requests/sec, using at most three client threads and a 12-second per-request curl timeout. The two scenarios were measured sequentially and must **not** be combined into a claim of 8 requests/sec load.

| Scenario | Successful / total | HTTP results | p50 (ms) | p95 (ms) | p99 (ms) | Completed rate | Responding origins |
|---|---:|---|---:|---:|---:|---:|---|
| `/demo/ok` (healthy) | 40 / 40 | 40 × HTTP 200 | 91.84 | 132.63 | 186.61 | 4.0 req/s | A: 20, B: 20 |
| `/demo/fail` (synthetic A failure) | 40 / 40 | 40 × HTTP 200 | 81.89 | 120.08 | 159.67 | 4.0 req/s | B: 40 |

### Interpretation and limitations

**80/80 successful HTTP responses** were observed across both synthetic scenarios in this single run. The request rate was **deliberately capped at 4 requests/sec**, and 4 req/s is *not* a measured capacity ceiling, peak throughput, or performance claim under sustained load.

The failure-scenario test returned 40 HTTP 200 responses from origin B. This establishes healthy fallback-origin response during a synthetic failure scenario, but **does not establish that each request attempted origin A first**. No attempt-tracing headers were observed in this run (`attempt_traces_seen = 0`). The latest tracing source must be deployed and tested separately to prove A→B retry within individual live requests.

Latency measurements are **client-observed end-to-end latency** from one shared GitHub-hosted runner, not Worker compute time. The sample is too small and narrow for production SLA, availability or statistical comparison claims. No real users, real backend services, unexpected failures or maximum-throughput load tests were involved. The initial attempt with Python urllib received 403 from the network edge; the verified successful sample used curl, consistent with prior smoke tests.

## CV-safe wording

> Deployed an authenticated Cloudflare Workers reliability prototype and validated **80/80 successful responses** in paced synthetic live tests at **4 req/s**, recording **p99 latency of 186.61 ms (healthy) and 159.67 ms (failure scenario)** from a GitHub Actions client.

The two scenarios have different routing behavior and must not be interpreted as proof that failures improve latency. The numbers may change with geography, routing state and client conditions.
