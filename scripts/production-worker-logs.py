"""Read historical Worker outcomes and allowlisted judge diagnostics through CI."""
import datetime
import json
import os
import re
import urllib.request

start = datetime.datetime.fromisoformat(os.environ["QUOREM_WORKER_LOG_START"])
if start.tzinfo is None:
    raise ValueError("Timestamp requires a timezone")
end = min(start + datetime.timedelta(minutes=30), datetime.datetime.now(datetime.timezone.utc))
account = os.environ["CLOUDFLARE_ACCOUNT_ID"]
headers = {
    "Authorization": "Bearer " + os.environ["CLOUDFLARE_API_TOKEN"],
    "Content-Type": "application/json",
}
workers = [
    "quorem-hono-production",
    "quorem-hono-services-production",
    "quorem-hono-services-production-verifier",
]


def query(path, body):
    request = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/{path}",
        data=json.dumps(body).encode(),
        headers=headers,
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


for worker in workers:
    # Analytics aggregates invocation outcomes independently of retained console logs.
    analytics = query("graphql", {
        "query": """query($account: string, $start: string, $end: string, $script: string) {
          viewer { accounts(filter: {accountTag: $account}) {
            workersInvocationsAdaptive(limit: 500, filter: {
              datetime_geq: $start, datetime_lt: $end, scriptName: $script, status_neq: "success"
            }) { dimensions { datetime scriptName status } sum { requests } }
          } }
        }""",
        "variables": {"account": account, "start": start.isoformat(), "end": end.isoformat(),
                      "script": worker},
    })
    for error in analytics.get("errors") or []:
        print("Analytics query error:", error.get("message"))
    for result in (analytics.get("data") or {}).get("viewer", {}).get("accounts", []):
        print(worker, "non-success invocations:", json.dumps(result["workersInvocationsAdaptive"]))

    logs = query(f"accounts/{account}/workers/observability/telemetry/query", {
        "queryId": "quorem-judge-worker-diagnostics",
        "timeframe": {"from": int(start.timestamp() * 1000), "to": int(end.timestamp() * 1000)},
        "view": "events",
        "limit": 1000,
        "dry": True,
        "parameters": {
            "datasets": ["cloudflare-workers", "workers"],
            "filters": [{"key": "$workers.scriptName", "type": "string",
                         "operation": "eq", "value": worker}],
        },
    })
    events = (logs.get("result") or {}).get("events") or {}
    print(worker, "historical events:", events.get("count", 0))
    for event in events.get("events", []):
        source = event.get("source")
        message = source if isinstance(source, str) else (source or {}).get("message", "")
        if not isinstance(message, str):
            continue
        category = re.search(
            r"runner-drain-failed|judging-drain-completed|case-lifecycle (?:stream-failed|child-(?:status-[0-9]{3}|failure-(?:limit|timeout|other)))",
            message,
        )
        if category:
            print(datetime.datetime.fromtimestamp(event["timestamp"] / 1000, datetime.timezone.utc),
                  category.group())
