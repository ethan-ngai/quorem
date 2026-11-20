"""Read Neon compute history, optionally sampling an already-running Postgres."""
import json
import os
import re
import subprocess
import urllib.parse
import urllib.request

project = os.environ["NEON_PROJECT_ID"]
if not re.fullmatch(r"[a-z0-9-]{1,60}", project):
    raise SystemExit("Invalid Neon project identifier")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


opener = urllib.request.build_opener(NoRedirect())


def get(path):
    url = f"https://console.neon.tech/api/v2/projects/{project}{path}"
    request = urllib.request.Request(
        url, headers={"Authorization": "Bearer " + os.environ["NEON_API_KEY"]}
    )
    with opener.open(request, timeout=15) as response:
        return json.load(response)


primary = [branch for branch in get("/branches")["branches"]
           if branch.get("default") or branch.get("primary")]
if len(primary) != 1:
    raise SystemExit("Ambiguous production branch")
branch = primary[0]["id"]
endpoints = [row for row in get(f"/branches/{branch}/endpoints")["endpoints"]
             if row.get("type") == "read_write"]
if len(endpoints) != 1:
    raise SystemExit("Ambiguous production endpoint")
endpoint = endpoints[0]
history = get("/operations?limit=100")["operations"]
print(json.dumps({
    "state": endpoint.get("current_state"),
    "suspendTimeoutSeconds": endpoint.get("suspend_timeout_seconds"),
    "operations": [
        {key: row.get(key) for key in ("action", "status", "created_at")}
        for row in history if row.get("endpoint_id") == endpoint.get("id")
    ][:35],
}), flush=True)

if os.environ.get("NEON_SAMPLE_CONNECTIONS") == "true" and endpoint.get("current_state") == "active":
    databases = [row for row in get(f"/branches/{branch}/databases")["databases"]
                 if row.get("name") == (os.environ.get("NEON_DATABASE_NAME") or "neondb")]
    if len(databases) != 1:
        raise SystemExit("Ambiguous production database")
    database = databases[0]
    query = urllib.parse.urlencode({
        "branch_id": branch, "database_name": database["name"],
        "role_name": database["owner_name"],
    })
    uri = get("/connection_uri?" + query)["uri"]
    print("::add-mask::" + uri, flush=True)
    sample = subprocess.run(
        ["psql", "-X", "-d", uri, "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c", """
          BEGIN READ ONLY;
          SET LOCAL statement_timeout = '5s';
          SELECT coalesce(json_agg(summary), '[]'::json)
          FROM (
            SELECT CASE
              WHEN application_name = 'Cloudflare Hyperdrive' THEN 'hyperdrive'
              WHEN application_name = '' THEN 'unnamed'
              ELSE 'other client'
            END AS application,
            state, wait_event_type, count(*) AS sessions,
            round(max(extract(epoch FROM clock_timestamp() - backend_start))) AS oldest_seconds,
            round(max(extract(epoch FROM clock_timestamp() - state_change))) AS oldest_state_seconds
            FROM pg_stat_activity
            WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid()
            GROUP BY 1,2,3
          ) summary;
          ROLLBACK;
        """],
        env={**os.environ, "PGCONNECT_TIMEOUT": "5"},
    )
    if sample.returncode:
        raise SystemExit("Production connection snapshot failed")
