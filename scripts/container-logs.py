"""Read-only Cloudflare startup logs or bounded judge invocation timings."""
import argparse
import datetime
import json
import os
import re
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit

parser = argparse.ArgumentParser()
parser.add_argument("--minutes", type=int, default=30)
parser.add_argument("--limit", type=int, default=200)
parser.add_argument("--stdout", action="store_true")
parser.add_argument("--wake-trace-start", help="UTC start of a two-minute wake trace")
args = parser.parse_args()
account = os.environ["CLOUDFLARE_ACCOUNT_ID"]
token = os.environ["CLOUDFLARE_API_TOKEN"]
secret_values = [value for name, value in os.environ.items()
                 if any(word in name for word in ("SECRET", "TOKEN", "PASSWORD", "DATABASE_URL"))]


def safe(value):
    text = str(value)
    for secret in secret_values:
        if secret:
            text = text.replace(secret, "[REDACTED]")
    text = re.sub(r"postgres(?:ql)?://[^\s\"']+", "[DATABASE_URL]", text)
    text = re.sub(r"(?i)(password|secret|token|authorization)(\s*[=:]\s*)[^\s,;]+",
                  r"\1\2[REDACTED]", text)
    return text


now = int(time.time() * 1000)
body = {
    "queryId": "quorem-container-startup-diagnostic",
    "timeframe": {"from": now - args.minutes * 60000, "to": now},
    "view": "events", "limit": args.limit, "dry": True,
    "parameters": {"datasets": ["containers"]},
}
if args.wake_trace_start:
    try:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z", args.wake_trace_start):
            raise ValueError()
        start = int(datetime.datetime.fromisoformat(args.wake_trace_start).timestamp() * 1000)
    except ValueError:
        parser.error("Wake trace requires an ISO-8601 UTC timestamp")
    body.update({
        "queryId": "quorem-judge-wake-trace",
        "timeframe": {"from": start, "to": min(start + 120000, now)},
        "parameters": {
            "datasets": ["cloudflare-workers"],
            "filterCombination": "or",
            "filters": [
                {"key": "$metadata.service", "operation": "eq", "type": "string", "value": name}
                for name in ("quorem-hono-production", "quorem-hono-services-production")
            ],
        },
    })
url = f"https://api.cloudflare.com/client/v4/accounts/{account}/workers/observability/telemetry/query"
request = urllib.request.Request(url, data=json.dumps(body).encode(), headers={
    "Authorization": "Bearer " + token, "Content-Type": "application/json",
})
try:
    with urllib.request.urlopen(request, timeout=35) as response:
        payload = json.load(response)
except urllib.error.HTTPError as error:
    print(f"Telemetry query failed: HTTP {error.code}.")
    if error.code == 403:
        print("API requires Workers Observability Write; default Wrangler OAuth returns 403.")
        print("Use an appropriately scoped CLOUDFLARE_API_TOKEN or the existing dashboard session.")
    raise SystemExit(1)
result = payload.get("result", {})
events = result.get("events", {}).get("events", [])
if args.wake_trace_start:
    routes = {"/v1/submissions": "admission", "/internal/drain": "runner-ingress",
              "/internal/runner/drain": "api-drain"}
    timings = []
    for event in events:
        worker = event.get("$workers", {})
        invocation = worker.get("event") or {}
        method = invocation.get("request", {}).get("method")
        path = urlsplit(event.get("url") or invocation.get("request", {}).get("url") or "").path
        phase = "queue" if worker.get("eventType") == "queue" else (
            routes.get(path) if method == "POST" else None
        )
        if phase and isinstance(worker.get("wallTimeMs"), (int, float)):
            timings.append({
                "at": event["timestamp"], "phase": phase, "wallMs": worker["wallTimeMs"],
                "cpuMs": worker.get("cpuTimeMs"),
            })
    print(json.dumps({"matched": len(events), "wakeTrace": sorted(timings, key=lambda row: row["at"])}))
    raise SystemExit(0)

selected = []
for event in events:
    if not (event.get("$containers") is not None or "container" in event.get("dataset", "")):
        continue
    metadata = event.get("$metadata", {})
    source = event.get("source", "")
    message = source if isinstance(source, str) else source.get("message", metadata.get("message", ""))
    if not message:
        message = metadata.get("error", "")
    indicators = json.dumps({"containers": event.get("$containers"), "source": source,
                             "level": metadata.get("level"), "type": metadata.get("type")}).lower()
    if not args.stdout and not any(word in indicators for word in ("stderr", "error", "fatal", "traceback")):
        continue
    stamp = datetime.datetime.fromtimestamp(event["timestamp"] / 1000, datetime.timezone.utc).isoformat()
    selected.append((stamp, safe(message)))
print(f"Matched {result.get('events', {}).get('count', 0)} events; selected {len(selected)} container log lines.")
for stamp, message in selected:
    print(stamp, message)
if events and not selected:
    print("Returned dataset names:", sorted({event.get("dataset", "") for event in events}))
