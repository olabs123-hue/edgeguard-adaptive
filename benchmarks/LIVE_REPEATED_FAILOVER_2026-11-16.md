# Verified repeated live synthetic A→B failover — 16 November 2026 UTC

## Sources

- [Successful three-trial GitHub Actions run](https://github.com/olabs123-hue/edgeguard-adaptive/actions/runs/43981537851)
- [JSON aggregate artifact](https://github.com/olabs123-hue/edgeguard-adaptive/actions/runs/43981537851/artifacts/14281754655)
- [Python experiment source](repeated_trace.py)
- Target: `https://edgeguard-adaptive.olabosoyeolamide123.workers.dev/demo/fail`

## Method

Three sequential trials of 20 authenticated, paced requests each (**60 total**, **2 requests/sec**). The deployed Cloudflare Worker has two private synthetic origin service bindings: A returns 503 for this route; B returns 200. Client ran on one GitHub-hosted Ubuntu runner. The benchmark did **not** force a particular origin selection. The app bearer token was read from GitHub Actions secrets and never printed.

A request counts as **confirmed A→B failover** only if it has HTTP 200, responding origin B and a request trace matching `origin-a:503:<ms>ms,origin-b:200:<ms>ms`.

## Results

| Trial | Measured requests | HTTP 200 | Confirmed A503→B200 same-request traces | Median Worker duration for confirmed traces |
|---|---:|---:|---:|---:|
| 1 | 20 | 20 | 10 | 36.5 ms |
| 2 | 20 | 20 | 1 | 46 ms |
| 3 | 20 | 20 | 1 | 52 ms |
| **Combined** | **60** | **60** | **12** | **43 ms** (median across 12 confirmed traces) |

Additional measurements across only the **12 confirmed paired traces**:

- p95 Worker-reported request duration: **58.75 ms**
- Median Origin A attempt duration: **20 ms**
- Median Origin B attempt duration: **19.5 ms**
- 60/60 traces present; 60/60 final responses from Origin B
- The remaining **48/60** requests had no observed A503→B200 pair (often direct routing to Origin B); they **must not** be described as confirmed failovers

### Interpretation

The data demonstrates **12 observed same-request retries from synthetic failing Origin A to healthy Origin B**, all ending with HTTP 200. **43 ms is the median Worker-reported total request duration among the 12 confirmed paired requests**, **not** median time for health detection, circuit recovery, process recovery or a real service outage. The 12/60 figure describes the proportion of requests exhibiting a paired trace in this run, **not** a 20% success rate or failure rate.

This was a short synthetic test with a shared GitHub runner, isolate-local routing state, fixed offered rate and controlled origin behavior. It does not establish throughput capacity, production-scale resilience or SLA. Previously documented [three-trial live latency samples](LIVE_THREE_TRIAL_2026-11-16.md) are distinct experiments and should not be combined into a pooled latency distribution.

## CV-safe wording

> Confirmed 12 live A→B retries from synthetic HTTP 503 failures to HTTP 200 responses across 60 controlled requests, with 43 ms median Worker-reported duration for confirmed paired requests (three trials; 2 req/s).

This wording does not claim all 60 requests retried or that 43 ms represents circuit recovery time.
