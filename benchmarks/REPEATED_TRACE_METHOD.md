# Repeated live failover trace experiment

The [repeated trace workflow](../.github/workflows/repeated-failover-trace.yml) measures 3 trials of 20 requests at **2 requests/second** against an authenticated synthetic failure route. It only counts a verified A→B retry when one response carries a trace matching `origin-a:503:<duration>ms,origin-b:200:<duration>ms`, plus HTTP 200 and responding origin B. Direct B responses do not count as failovers.

The experiment records Worker-reported total request durations for verified paired traces. **That is not recovery time for an open circuit or a measured production incident.** If no paired attempts are observed, it reports zero and does not fabricate a median. Output is written to `repeated-trace-results.json` as an Actions artifact (30-day retention). The application bearer secret remains only in the GitHub Actions secret.

This workload is intentionally small and cannot establish production-scale capacity or availability.
