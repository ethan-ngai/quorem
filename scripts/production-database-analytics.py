"""Summarize Worker DB use and public catalog requests without touching PostgreSQL."""
import collections
import datetime
import json
import os
import urllib.request

START = datetime.datetime.fromisoformat(os.environ["QUOREM_DATABASE_ANALYTICS_START"])
if START.utcoffset() is None:
    raise SystemExit("Analytics start requires a timezone")
END = min(
    START + datetime.timedelta(minutes=15),
    datetime.datetime.now(datetime.timezone.utc),
)
if END <= START:
    raise SystemExit("Empty analytics window")
ACCOUNT = os.environ["CLOUDFLARE_ACCOUNT_ID"]


def query(path, body):
    request = urllib.request.Request(
        "https://api.cloudflare.com/client/v4/" + path,
        data=json.dumps(body).encode(),
        headers={
            "Authorization": "Bearer " + os.environ["CLOUDFLARE_API_TOKEN"],
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


result = query(f"accounts/{ACCOUNT}/workers/observability/telemetry/query", {
    "queryId": "quorem-database-usage",
    "timeframe": {"from": int(START.timestamp() * 1000), "to": int(END.timestamp() * 1000)},
    "view": "events",
    "limit": 1000,
    "dry": True,
    "parameters": {
        "datasets": ["cloudflare-workers"],
        "filters": [
            {"key": "$metadata.service", "type": "string", "operation": "eq",
             "value": "quorem-hono-production"},
            {"key": "event", "type": "string", "operation": "eq", "value": "database-usage"},
        ],
    },
})
if not result.get("success"):
    raise SystemExit("Cloudflare Worker database usage query failed")
events = (result.get("result") or {}).get("events") or {}
counts = collections.defaultdict(collections.Counter)
minutes = collections.Counter()
for event in events.get("events", []):
    source = event.get("source")
    if not isinstance(source, dict) or source.get("event") != "database-usage":
        continue
    fields = tuple(source.get(key, "unknown") for key in ("trigger", "operation", "principal"))
    if not all(isinstance(label, str) and len(label) <= 48 and
               all(character.isalnum() or character in "._-" for character in label)
               for label in fields):
        continue
    query_calls = source.get("queryCalls")
    if not isinstance(query_calls, int) or query_calls < 0:
        continue
    counts[fields].update(records=1, queryCalls=query_calls)
    stamp = event.get("timestamp")
    if isinstance(stamp, (int, float)):
        minute = datetime.datetime.fromtimestamp(stamp / 1000, datetime.timezone.utc)
        minutes[minute.replace(second=0, microsecond=0).isoformat()] += query_calls
print(json.dumps({
    "start": START.isoformat(), "end": END.isoformat(),
    "workerRowsReported": events.get("count", 0), "workerRowsReturned": len(events.get("events", [])),
    "byOperation": [
        {"trigger": trigger, "operation": operation, "principal": principal, **count}
        for (trigger, operation, principal), count in
        sorted(counts.items(), key=lambda item: -item[1]["queryCalls"])
    ],
    "queryCallsByMinute": dict(sorted(minutes.items())),
}))

response = query("graphql", {
    "query": """query CatalogTraffic($zone: string!, $start: Time!, $end: Time!) {
      viewer { zones(filter: {zoneTag: $zone}) {
        httpRequestsAdaptiveGroups(limit: 20, orderBy: [count_DESC], filter: {
          datetime_geq: $start, datetime_lt: $end, requestSource: "eyeball",
          clientRequestHTTPHost: "quorem.app", clientRequestPath: "/v1/problems"
        }) { count dimensions { edgeResponseStatus cacheStatus } }
      } }
    }""",
    "variables": {
        "zone": os.environ["CLOUDFLARE_ZONE_ID"],
        "start": START.isoformat(), "end": END.isoformat(),
    },
})
if response.get("errors"):
    denied = any("analytics.read" in error.get("message", "") for error in response["errors"])
    print(json.dumps({"catalogAnalytics": "permission-denied" if denied else "unavailable"}))
else:
    print(json.dumps({"publicCatalogPath": response["data"]["viewer"]["zones"]}))
