#!/usr/bin/env python3
"""Inside the runner image, compare two references on supplied inputs."""
import json
import subprocess
import sys

payload = json.load(sys.stdin)
results = []
for args in payload['cases']:
    values = []
    for source in payload['sources']:
        request = {'source': source, 'signature': payload['signature'], 'args': args}
        try:
            process = subprocess.run(['python', '-B', '/opt/quorem/harness.py'], input=json.dumps(request).encode(), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=2, check=True)
            result = json.loads(process.stdout.lstrip(b'\0'))
            if result.get('status') != 'executed': break
            values.append(result['actual'])
        except (subprocess.SubprocessError, json.JSONDecodeError, KeyError):
            break
    if len(values) == 2 and values[0] == values[1]:
        results.append({'args': args, 'expected': values[0]})
json.dump(results, sys.stdout, ensure_ascii=False, allow_nan=False)
