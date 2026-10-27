#!/usr/bin/env python3
"""Run draft references through the Quorem Python harness inside a sandbox container."""
import argparse
import hashlib
from concurrent.futures import ThreadPoolExecutor
import json
import subprocess
from pathlib import Path


def validate(path):
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    draft = json.loads(data)
    sig = draft['problem']['signature']
    source = draft['implementations'][0]['referenceSource']
    for index, case in enumerate(draft['problem']['examples'] + draft['hiddenCases'], 1):
        request = {'source': source, 'signature': sig, 'args': case['args']}
        try:
            process = subprocess.run(['python', '-B', '/opt/quorem/harness.py'], input=json.dumps(request).encode(), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=2, check=True)
            result = json.loads(process.stdout.lstrip(b'\0'))
        except (subprocess.SubprocessError, json.JSONDecodeError):
            return {'id': path.stem, 'sha256': digest, 'status': 'harness_error', 'case': index}
        if result.get('status') != 'executed' or result.get('actual') != case['expected']:
            return {'id': path.stem, 'sha256': digest, 'status': result.get('status', 'missing_status'), 'case': index, 'matches': result.get('status') == 'executed' and result.get('actual') == case['expected']}
    return {'id': path.stem, 'sha256': digest, 'status': 'passed', 'cases': len(draft['problem']['examples']) + len(draft['hiddenCases'])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--limit', type=int, default=0)
    parser.add_argument('--jobs', type=int, default=1, choices=range(1, 9))
    args = parser.parse_args()
    paths = sorted((p for p in args.directory.glob('*.json') if p.stem.isdigit()), key=lambda p: int(p.stem))
    if args.limit:
        paths = paths[:args.limit]
    with ThreadPoolExecutor(max_workers=args.jobs) as executor:
        for result in executor.map(validate, paths):
            print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
