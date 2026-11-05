"""Read-only Cloudflare startup logs query; credentials never enter output."""
import argparse
import datetime
import json
import os
import re
import time
import urllib.error
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("--minutes", type=int, default=30)
parser.add_argument("--limit", type=int, default=200)
parser.add_argument("--stdout", action="store_true")
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
