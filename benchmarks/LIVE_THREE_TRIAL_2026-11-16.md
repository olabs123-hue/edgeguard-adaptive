# Live three-trial synthetic benchmark — 16 November 2026 UTC

## Reproducible evidence

- [Successful three-trial workflow run](https://github.com/olabs123-hue/edgeguard-adaptive/actions/runs/43980181675)
- [Download run artifact](https://github.com/olabs123-hue/edgeguard-adaptive/actions/runs/43980181675/artifacts/14283310902)
- [Benchmark implementation](live_sample.py)

The benchmark was executed against `https://edgeguard-adaptive.olabosoyeolamide123.workers.dev` from a GitHub-hosted Ubuntu runner, using a separate app bearer token from GitHub Actions secrets.

## Method

Three sequential trials. Each trial independently measured 40 requests to `/demo/ok` and 40 requests to `/demo/fail`, after one excluded warm-up request per scenario. **Each scenario was paced to 4 requests/sec**, with at most 3 client threads. **240 measured requests** total. The per-trial percentiles are *client-observed wall-clock HTTP latency*, not Cloudflare Worker CPU duration.

| Scenario | Successful / measured requests | Median trial p50 | Median trial p95 | Median trial p99 | Result origin |
|---|---:|---:|---:|---:|---|
| Healthy `/demo/ok` | 120/120 (100%) | 87.58 ms | 137.86 ms | 154.35 ms | A or B |
| Injected-failure `/demo/fail` | 120/120 (100%) | 85.53 ms | 119.95 ms | 137.69 ms | B |

Individual trial p99 latency (ms):

| Scenario | Trial 1 | Trial 2 | Trial 3 |
|---|---:|---:|---:|
| Healthy | 357.73 | 154.35 | 124.76 |
| Injected failure | 119.98 | 179.99 | 137.69 |

**Major caveats:**
- 4 req/s is an *intentional offered rate*, not a measured maximum throughput. The two scenarios were measured separately and sequentially.
- Synthetic fixture A returns HTTP 503 for `/demo/fail`; fixture B can return HTTP 200. The 120 successful responses from B **do not establish that each request attempted A first**.
- No per-attempt trace headers were observed in the live benchmark (`attempt_traces_seen=0`). The new trace code still needs to be deployed with the manual [connected deployment workflow](../.github/workflows/deploy-connected-demo.yml) before per-request A→B evidence can be gathered.
- Median of 3 per-trial p99 values is **not** the pooled overall p99. Report it as **median trial p99**, not just p99.
- Shared GitHub runner and internet path, nonproduction fixture origins, short workload, no availability/SLA or peak-capacity guarantees.
- The overall success count 240/240 covers 120 healthy-scenario and 120 synthetic-failure-scenario requests; it is not a statement about real-world origin failure recovery.

## CV-safe bullet

> Validated 240/240 successful HTTP responses across three live synthetic Cloudflare Workers trials (4 req/s per scenario), recording median trial p99 latencies of 154 ms for healthy routing and 138 ms for the injected-failure scenario.

Keep the words **synthetic**, **trial**, and **4 req/s**; do not present these as production-scale capacity or proven per-request automatic failover.
