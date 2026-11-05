"""Read only Hyperdrive latency and pool metrics around a judging benchmark."""
import datetime
import json
import os
import urllib.error
import urllib.request

account = os.environ["CLOUDFLARE_ACCOUNT_ID"]
token = os.environ["CLOUDFLARE_API_TOKEN"]
start = datetime.datetime.fromisoformat(os.environ["QUOREM_BENCHMARK_START"])
end = start + datetime.timedelta(minutes=2)


def request(path, body=None):
    req = urllib.request.Request(
        "https://api.cloudflare.com/client/v4" + path,
        data=json.dumps(body).encode() if body else None,
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


configs = request(f"/accounts/{account}/hyperdrive/configs").get("result", [])
selected = [config for config in configs if config["name"] == "quorem-hono-production-database"]
if len(selected) != 1:
    raise SystemExit("Production Hyperdrive configuration unavailable")
query = """
query JudgeHyperdrive($account: string!, $config: string!, $start: Time!, $end: Time!) {
  viewer { accounts(filter: {accountTag: $account}) {
    hyperdriveQueriesAdaptiveGroups(limit: 1000, filter: {
      configId: $config, datetime_geq: $start, datetime_leq: $end
    }) {
      count avg { connectionLatency queryLatency }
      dimensions { coloCode cacheStatus }
    }
    hyperdrivePoolSizesAdaptiveGroups(limit: 1000, filter: {
      configId: $config, datetime_geq: $start, datetime_leq: $end
    }) {
      avg { currentPoolSize availablePoolSlots waitingClients }
      max { maxPoolSize currentPoolSize waitingClients }
      dimensions { coloCode }
    }
  } }
}
"""
result = request("/graphql", {
    "query": query,
    "variables": {"account": account, "config": selected[0]["id"],
                  "start": start.isoformat(), "end": end.isoformat()},
})
if result.get("errors"):
    print(json.dumps({"metricsErrors": [error.get("message") for error in result["errors"]]}))
    raise SystemExit(1)
print(json.dumps({"hyperdriveMetrics": result["data"]["viewer"]["accounts"]}))
