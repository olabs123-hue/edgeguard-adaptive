# Live synthetic performance samples

The [Live synthetic performance sample](../.github/workflows/live-performance-sample.yml) GitHub Actions workflow sends a limited, paced workload through the **actually deployed** Cloudflare Worker and its synthetic private origins.

- Two paths: `/demo/ok` (healthy) and `/demo/fail` (origin A returns a synthetic 503; origin B succeeds)
- Default: 40 measured requests per path, at an arrival target of 4 req/s; one warm-up request per path
- Hard caps: 60 measured requests per path and 5 req/s per path
- Measures wall-clock client latency distribution, HTTP statuses, apparent responding origin, and optional attempt traces.
- Captures completed requests per second **at the chosen arrival rate**; not system capacity, peak throughput or real production traffic.
- Stores raw per-scenario summary JSON as a short-retention GitHub Actions artifact. Never includes the bearer token.
- Public Cloudflare usage and traffic limits still apply. The workflow is both manually triggerable and run once when its benchmark script or workflow changes.

## Citation guidance for CVs

Quantify results only after the workflow succeeds. Attribute numbers explicitly to a **paced 4 req/s synthetic GitHub Actions sample** rather than general infrastructure capacity. Describe the `/demo/fail` success rate as success returning from a *synthetic failure scenario*, **not** failover success on every request unless request traces confirm an A→B attempt sequence.

Results will be influenced by the shared runner, internet path, geographic location, Cloudflare isolate state, retries and transient load. The sample is short and cannot establish production reliability or peak throughput. For stronger evidence, run multiple independent trials at a fixed arrival rate and publish the trial-level summary.
