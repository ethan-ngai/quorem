"""Read only allowlisted lifecycle events from an isolated validation Worker."""
import json
import os
import re
import time
import urllib.request

run = os.environ["VALIDATION_RUN_ID"]
if not re.fullmatch(r"[0-9]{1,20}", run):
    raise SystemExit("Invalid validation run ID")
worker = "quorem-validation-" + run
now = int(time.time() * 1000)
body = {"queryId": "quorem-case-diagnostic", "timeframe": {"from": now - 7200000, "to": now},
        "view": "events", "limit": 1000, "dry": True, "parameters": {"datasets": ["workers"]}}
account = os.environ["CLOUDFLARE_ACCOUNT_ID"]
request = urllib.request.Request(
    f"https://api.cloudflare.com/client/v4/accounts/{account}/workers/observability/telemetry/query",
    data=json.dumps(body).encode(), headers={"Authorization": "Bearer " + os.environ["CLOUDFLARE_API_TOKEN"],
                                             "Content-Type": "application/json"})
with urllib.request.urlopen(request, timeout=35) as response:
    payload = json.load(response)
events = payload.get("result", {}).get("events", {}).get("events", [])
allowed = re.compile(r"case-lifecycle (?:stop-begin|destroy-complete|stop-complete|delete-begin|delete-complete|exec-ready (?:python|java|typescript|ocaml|postgresql)|streams-complete (?:python|java|typescript|ocaml|postgresql)|stream-failed (?:python|java|typescript|ocaml|postgresql))")

def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from strings(item)

matches = 0
for event in events:
    values = list(strings(event))
    if not any(worker in value for value in values):
        continue
    matches += 1
    for value in values:
        if allowed.fullmatch(value):
            print(value)
print(f"Read {len(events)} events; matched {matches} validation events.")
