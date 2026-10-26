#!/usr/bin/env python3
"""Run staged candidates against examples, hidden cases and independently calculated boundary probes.

Run only inside the documented networkless judge container: source code is untrusted.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import subprocess
from pathlib import Path


def boundary_cases():
    n = 1500
    edges = [[i, i + 1] for i in range(n - 1)]
    return {
        3290: ([[1] * 4, [1] * n], 4),
        1872: ([[0] * n], 0),
        2435: ([[[0] * n], 1], 1),
        2049: ([[-1] + list(range(n - 1))], 2),
        3249: ([edges], n),
        714: ([[1] * n, 0], 0),
        309: ([[1] * n], 0),
        3196: ([[1] * n], n),
        2246: ([[-1] + list(range(n - 1)), 'ab' * (n // 2)], n),
        1466: ([n, edges], n - 1),
        2316: ([n, edges], 0),
        2368: ([n, edges, [n - 1]], n - 1),
        2492: ([n, [[i + 1, i + 2, 1] for i in range(n - 1)]], 1),
        2522: (['1' * n, 1], n),
        3117: ([[1] * n, [1]], 1),
    }


def validate(path):
    data = path.read_bytes()
    item = json.loads(data)
    id = int(path.stem)
    boundary_args, boundary_expected = boundary_cases()[id]
    cases = item['problem']['examples'] + item['hiddenCases']
    checks = cases + [{'args': boundary_args, 'expected': boundary_expected}]
    for index, case in enumerate(checks):
        implementation = next(value for value in item['implementations'] if value['language'] == 'python')
        request = {'source': implementation['referenceSource'], 'signature': item['problem']['signature'], 'args': case['args']}
        try:
            result = subprocess.run(['python', '-B', '/opt/quorem/harness.py'], input=json.dumps(request).encode(), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=3, check=True)
            output = json.loads(result.stdout.lstrip(b'\0'))
        except (subprocess.SubprocessError, json.JSONDecodeError):
            return {'id': str(id), 'sha256': hashlib.sha256(data).hexdigest(), 'status': 'harness_error', 'case': index + 1}
        if output.get('status') != 'executed' or output.get('actual') != case['expected']:
            return {'id': str(id), 'sha256': hashlib.sha256(data).hexdigest(), 'status': output.get('status', 'missing_status'), 'case': index + 1, 'matches': False}
    return {'id': str(id), 'sha256': hashlib.sha256(data).hexdigest(), 'status': 'passed', 'cases': len(cases), 'boundary': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--jobs', type=int, choices=range(1, 9), default=1)
    args = parser.parse_args()
    paths = sorted(args.directory.glob('[0-9]*.json'), key=lambda p: int(p.stem))
    if {int(path.stem) for path in paths} != set(boundary_cases()):
        parser.error('candidate set must exactly match the known boundary probes')
    with ThreadPoolExecutor(max_workers=args.jobs) as executor:
        for result in executor.map(validate, paths):
            print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
