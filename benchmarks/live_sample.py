#!/usr/bin/env python3
"""Low-rate, credential-safe smoke benchmark of *deployed* synthetic Cloudflare origins.

This is NOT a max-throughput/load test. Request rate deliberately capped to minimize
unintended Cloudflare usage. Does not print bearer tokens or request headers.
"""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import json
import math
import os
import statistics
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

DEFAULT_URL = "https://edgeguard-adaptive.olabosoyeolamide123.workers.dev"

def percentile(samples, p):
    if not samples:
        return None
    values = sorted(samples)
    rank = (len(values) - 1) * p / 100
    lower = int(math.floor(rank))
    upper = int(math.ceil(rank))
    return round(values[lower] + (values[upper] - values[lower]) * (rank - lower), 2)

def once(base_url, token, path):
    req = Request(base_url + path, headers={"Authorization": "Bearer " + token,
                                          "Accept": "application/json"})
    started = time.perf_counter()
    try:
        with urlopen(req, timeout=12) as response:
            status = response.status
            origin = response.headers.get("x-edgeguard-origin", "")
            trace = response.headers.get("x-edgeguard-attempt-trace", "")
            count = response.headers.get("x-edgeguard-attempt-count", "")
            response.read(8192)
    except HTTPError as exc:
        status = exc.code
        origin = exc.headers.get("x-edgeguard-origin", "")
        trace = exc.headers.get("x-edgeguard-attempt-trace", "")
        count = exc.headers.get("x-edgeguard-attempt-count", "")
    except (URLError, TimeoutError, OSError) as exc:
        status, origin, trace, count = 0, "", "", ""
    elapsed_ms = (time.perf_counter() - started) * 1000
    safe_pair = trace.startswith("origin-a:503:") and ",origin-b:200:" in trace
    return {"status": status, "origin": origin, "duration_ms": round(elapsed_ms, 2),
            "trace_present": bool(trace), "attempt_count": count,
            "observed_a_then_b": safe_pair}

def measure(base_url, token, path, count, rps):
    # Warm-up one request, excluded from all results.
    once(base_url, token, path)
    result = []
    with ThreadPoolExecutor(max_workers=3) as pool:
        pending = []
        start = time.perf_counter()
        for i in range(count):
            pending.append(pool.submit(once, base_url, token, path))
            next_at = start + (i + 1) / rps
            rest = next_at - time.perf_counter()
            if rest > 0:
                time.sleep(rest)
        for future in as_completed(pending):
            result.append(future.result())
    elapsed = time.perf_counter() - start
    timings = [x["duration_ms"] for x in result]
    statuses = Counter(str(x["status"]) for x in result)
    origins = Counter(x["origin"] or "none" for x in result)
    success = sum(x["status"] == 200 for x in result)
    return {"scenario": path, "requests": count, "configured_arrival_rps": rps,
            "elapsed_seconds": round(elapsed, 3),
            "completed_rps": round(count / elapsed, 3),
            "http_statuses": dict(statuses), "response_origins": dict(origins),
            "successful_responses": success, "success_percentage": round(100 * success / count, 2),
            "p50_ms": percentile(timings, 50), "p95_ms": percentile(timings, 95),
            "p99_ms": percentile(timings, 99),
            "attempt_traces_seen": sum(x["trace_present"] for x in result),
            "observed_a503_then_b200": sum(x["observed_a_then_b"] for x in result),
            "notes": "Paced synthetic requests; completed_rps is not maximum capacity. "
                     "origin-b HTTP 200 alone does not prove origin-a attempted. "
                     "Trace evidence applies only if the deployed version returns tracing headers."}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--count", type=int, default=40)
    parser.add_argument("--rps", type=float, default=4.0)
    parser.add_argument("--output", default="benchmark-results.json")
    args = parser.parse_args()
    if not (1 <= args.count <= 60 and 0 < args.rps <= 5):
        parser.error("Safety cap: 1-60 requests per scenario and <=5 requests/second")
    if not args.url.startswith("https://"):
        parser.error("HTTPS URL required")
    token = os.getenv("EDGEGUARD_DEMO_BEARER_TOKEN", "")
    if len(token) < 32:
        raise SystemExit("Missing or too-short benchmark bearer token in GitHub Actions secret")
    results = {
        "run_time_utc": datetime.now(timezone.utc).isoformat(),
        "target": args.url,
        "test_type": "low-rate synthetic live smoke benchmark, NOT load or capacity testing",
        "client": "GitHub-hosted Ubuntu Actions runner (shared public cloud network)",
        "scenarios": [measure(args.url, token, route, args.count, args.rps)
                      for route in ("/demo/ok", "/demo/fail")]
    }
    with open(args.output, "w", encoding="utf-8") as fh:
        json.dump(results, fh, indent=2)
    for scenario in results["scenarios"]:
        print(json.dumps(scenario, sort_keys=True))
    if any(s["successful_responses"] < s["requests"] for s in results["scenarios"]):
        raise SystemExit("Some synthetic live requests did not return HTTP 200")

if __name__ == "__main__":
    main()
