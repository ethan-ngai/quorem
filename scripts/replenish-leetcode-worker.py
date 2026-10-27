#!/usr/bin/env python3
"""Run candidate reference comparisons inside the networkless judge image."""
from concurrent.futures import ThreadPoolExecutor
import json
import subprocess
import sys


def check(job):
    accepted, failures = [], []
    for case in job['candidates']:
        request = {'source': job['reference'], 'signature': job['signature'], 'args': case['args']}
        try:
            result = subprocess.run(['python', '-B', '/opt/quorem/harness.py'], input=json.dumps(request).encode(), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=2, check=True)
            frame = json.loads(result.stdout.lstrip(b'\0'))
            matches = frame.get('status') == 'executed' and json.dumps(frame.get('actual'), sort_keys=True) == json.dumps(case['expected'], sort_keys=True)
        except (subprocess.SubprocessError, json.JSONDecodeError, ValueError):
            matches = False
        if matches:
            accepted.append(case)
            if len(accepted) == job['needed']: break
        else:
            failures.append(case['args'])
    return {'id': job['id'], 'accepted': accepted, 'failed': failures}


def main():
    jobs = json.load(sys.stdin)
    with ThreadPoolExecutor(max_workers=8) as executor:
        json.dump(list(executor.map(check, jobs)), sys.stdout, ensure_ascii=False, allow_nan=False)


if __name__ == '__main__': main()
