#!/usr/bin/env python3
"""Low-rate repeated live trace observations of EdgeGuard Adaptive.

Does not force a particular origin: counts A(503)->B(200) only when the live
x-edgeguard-attempt-trace header proves both attempts in one request.
The result is a synthetic observation sample, not real outage recovery SLA.
"""
import json
import os
import re
import statistics
import subprocess
import sys
import time
from datetime import datetime, timezone

URL = "https://edgeguard-adaptive.olabosoyeolamide123.workers.dev/demo/fail"
TRIALS = 3
REQUESTS_PER_TRIAL = 20
ARRIVAL_RPS = 2
PATTERN = re.compile(r"^origin-a:503:(\d+)ms,origin-b:200:(\d+)ms$")

def percentile(data, p):
    data = sorted(data)
    if not data:
        return None
    at = (len(data) - 1) * p / 100
    lo, hi = int(at), min(int(at) + 1, len(data) - 1)
    return round(data[lo] + (data[hi] - data[lo]) * (at - lo), 2)

def request_once(token):
    started = time.perf_counter()
    try:
        proc = subprocess.run([
            "curl", "--silent", "--show-error", "--max-time", "10",
            "--output", os.devnull, "--dump-header", "-",
            "--header", "Authorization: Bearer " + token,
            "--write-out", "\\nEG_STATUS=%{http_code}", URL
        ], capture_output=True, text=True, timeout=12, check=False)
        if proc.returncode:
            return {"http_status": 0, "origin": "", "trace": "",
                    "worker_ms": None, "client_ms": round(1000*(time.perf_counter()-started),2)}
        raw, code = proc.stdout.rsplit("EG_STATUS=", 1)
        headers = {}
        for line in raw.splitlines():
            if ":" in line:
                key, value = line.split(":", 1)
                headers[key.lower().strip()] = value.strip()
        duration = headers.get("x-edgeguard-total-ms")
        return {"http_status": int(code.strip()), "origin": headers.get("x-edgeguard-origin",""),
                "trace": headers.get("x-edgeguard-attempt-trace",""),
                "worker_ms": int(duration) if duration and duration.isdigit() else None,
                "client_ms": round(1000*(time.perf_counter()-started),2)}
    except (ValueError, OSError, subprocess.TimeoutExpired):
        return {"http_status": 0, "origin": "", "trace": "", "worker_ms": None,
                "client_ms": round(1000*(time.perf_counter()-started),2)}

def main():
    token = os.environ.get("EDGEGUARD_DEMO_BEARER_TOKEN","")
    if len(token) < 32:
        raise SystemExit("Expected GitHub Actions secret EDGEGUARD_DEMO_BEARER_TOKEN")
    all_results = []
    trial_summaries = []
    for trial in range(1, TRIALS+1):
        result = []
        start = time.monotonic()
        for i in range(REQUESTS_PER_TRIAL):
            result.append(request_once(token))
            wait = start + (i+1) / ARRIVAL_RPS - time.monotonic()
            if wait > 0:
                time.sleep(wait)
        all_results.extend(result)
        verified = [x for x in result if PATTERN.fullmatch(x["trace"])
                    and x["http_status"] == 200 and x["origin"] == "origin-b"]
        summary = {"trial": trial, "requests": len(result),
                   "http_200": sum(x["http_status"]==200 for x in result),
                   "responding_origin_b": sum(x["origin"]=="origin-b" for x in result),
                   "traced_a503_to_b200": len(verified),
                   "traces_present": sum(bool(x["trace"]) for x in result),
                   "median_verified_worker_request_ms": (
                        round(statistics.median(x["worker_ms"] for x in verified
                            if x["worker_ms"] is not None),2)
                        if any(x["worker_ms"] is not None for x in verified) else None)}
        trial_summaries.append(summary)
        print("TRIAL "+json.dumps(summary,sort_keys=True),flush=True)
    paired = [x for x in all_results if PATTERN.fullmatch(x["trace"])
              and x["http_status"]==200 and x["origin"]=="origin-b"]
    timings = [x["worker_ms"] for x in paired if x["worker_ms"] is not None]
    parts = [PATTERN.fullmatch(x["trace"]) for x in paired]
    report = {
        "test": "bounded live synthetic failure-route observation (not forced-origin)",
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "target": URL,
        "trials": TRIALS, "requests_per_trial": REQUESTS_PER_TRIAL,
        "arrival_rate_req_s": ARRIVAL_RPS,
        "total_requests": len(all_results),
        "http_200": sum(x["http_status"]==200 for x in all_results),
        "http_status_counts": {str(k):sum(x["http_status"]==k for x in all_results)
                              for k in sorted({x["http_status"] for x in all_results})},
        "origin_b_responses": sum(x["origin"]=="origin-b" for x in all_results),
        "traces_present": sum(bool(x["trace"]) for x in all_results),
        "verified_a503_to_b200_same_request": len(paired),
        "verified_failover_fraction_of_requests": round(len(paired)/len(all_results),4),
        "median_worker_duration_ms_for_verified_pairs": (
            round(statistics.median(timings),2) if timings else None),
        "p95_worker_duration_ms_for_verified_pairs": percentile(timings,95),
        "median_origin_a_attempt_ms_for_pairs": (
            round(statistics.median(int(p.group(1)) for p in parts),2) if parts else None),
        "median_origin_b_attempt_ms_for_pairs": (
            round(statistics.median(int(p.group(2)) for p in parts),2) if parts else None),
        "trial_summaries": trial_summaries,
        "interpretation": "Only paired A:503,B:200 trace proves per-request retry; "
                          "B-only responses do not. Worker duration is request handling, "
                          "NOT circuit recovery time or failover detection time. "
                          "Synthetic private origins; single GitHub runner."
    }
    with open("repeated-trace-results.json","w",encoding="utf8") as f:
        json.dump(report,f,indent=2)
    print("AGGREGATE "+json.dumps(report,sort_keys=True),flush=True)
    if report["http_200"] != report["total_requests"]:
        sys.exit("Not all synthetic requests returned 200")
    if not report["traces_present"]:
        sys.exit("No tracing headers; redeploy connected Worker with latest source")
    # Zero observed pairs is an honest valid result: router may choose B directly.
    # This experiment must never fabricate retries.

if __name__ == "__main__":
    main()
