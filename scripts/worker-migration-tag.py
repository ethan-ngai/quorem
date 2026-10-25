"""Read the live migration precondition; never change a Worker outside Terraform."""
import json
import sys
from urllib.parse import quote
from cloudflare_api import get

query = json.load(sys.stdin)
account = quote(query["account_id"], safe="")
script = quote(query["script_name"], safe="")
service = get(f"/accounts/{account}/workers/services/{script}", missing_ok=True)
tag = ((service or {}).get("default_environment", {}).get("script") or {}).get("migration_tag") or ""
print(json.dumps({"tag": tag}))
