#!/usr/bin/env python3
"""Export unchanged candidates passing structural and harness checks."""
import argparse
import hashlib
import json
from pathlib import Path


def load_results(path):
    results = {}
    for line in path.read_text().splitlines():
        row = json.loads(line)
        if row['id'] in results:
            raise ValueError('duplicate validation result')
        results[row['id']] = row
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('candidates', type=Path)
    parser.add_argument('structural_results', type=Path)
    parser.add_argument('harness_results', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('output already exists')
    structural, harness = load_results(args.structural_results), load_results(args.harness_results)
    args.output.mkdir(parents=True)
    count = 0
    for path in sorted(args.candidates.glob('*.json')):
        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        s, h = structural.get(path.stem, {}), harness.get(path.stem, {})
        content = json.loads(data)
        expected_cases = len(content['problem']['examples']) + len(content['hiddenCases'])
        if (s.get('sha256') != digest or s.get('error') != '' or h.get('sha256') != digest
                or h.get('status') != 'passed' or h.get('cases') != expected_cases):
            continue
        (args.output / path.name).write_bytes(data)
        count += 1
    print(f'Exported {count} structurally valid, reference-checked fixtures')


if __name__ == '__main__':
    main()
