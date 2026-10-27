"""Read an existing workers.dev subdomain without mutating account settings."""
import json
import re
import sys
from cloudflare_api import get

query = json.load(sys.stdin)
account = query['account_id']
if not re.fullmatch(r'[0-9a-fA-F]{32}', account):
    raise SystemExit('Invalid account identifier')
result = get(f'/accounts/{account}/workers/subdomain')
name = result.get('subdomain', '')
if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,62}', name):
    raise SystemExit('Workers subdomain unavailable')
print(json.dumps({'name': name}))
