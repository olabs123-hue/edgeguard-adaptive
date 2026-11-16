# Verified per-request failover — live Cloudflare Worker

## Evidence

- [GitHub Actions live smoke test, successful rerun](https://github.com/olabs123-hue/edgeguard-adaptive/actions/runs/43980748267)
- Target: `edgeguard-adaptive.olabosoyeolamide123.workers.dev`
- Source: GitHub-hosted Ubuntu runner, using a repository secret for authenticated routing.
- Scenario: `GET /demo/fail`, with synthetic private origin A configured to return HTTP 503 and origin B configured to return HTTP 200.

## Observed results

| Check | Observed |
|---|---|
| Public health endpoint | HTTP 200 |
| Unauthenticated proxy path | HTTP 401 |
| Authenticated `/demo/fail` | HTTP 200, response from `origin-b` |
| Attempts within same request | 2 |
| Attempt 1 | `origin-a:503:39ms` |
| Attempt 2 | `origin-b:200:38ms` |
| Worker-reported total duration | 77 ms |

Live trace header:
```
x-edgeguard-attempt-trace: origin-a:503:39ms,origin-b:200:38ms
x-edgeguard-attempt-count: 2
x-edgeguard-total-ms: 77
```

**Interpretation:** This single request directly demonstrates an A→B failover in the deployed Cloudflare Worker. It is a synthetic test with two private fixture Workers, not a production outage or a measured service level agreement. The 77 ms value is **Worker-reported duration** for this observed request, not the median or p99 failover recovery time.

See also [three-trial paced synthetic live benchmark](LIVE_THREE_TRIAL_2026-11-16.md) for 240/240 HTTP 200 responses across healthy and synthetic-failure scenarios. Those benchmark samples did not include attempt traces and cannot be assumed to each perform A→B failover.
