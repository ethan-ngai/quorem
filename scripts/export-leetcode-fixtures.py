#!/usr/bin/env python3
"""Export unchanged candidates passing structural and harness checks."""
import argparse
import hashlib
import json
from pathlib import Path
from audit_leetcode_cases import assess


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
    parser.add_argument('--stage-report', type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('output already exists')
    structural, harness = load_results(args.structural_results), load_results(args.harness_results)
    sources = json.loads(args.stage_report.read_text())['sources']
    corpus = json.loads((args.candidates.parent / 'report.json').read_text())['corpus']
    args.output.mkdir(parents=True)
    fixtures = []
    candidate_count = 0
    for path in sorted(args.candidates.glob('*.json')):
        candidate_count += 1
        data = path.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        s, h = structural.get(path.stem, {}), harness.get(path.stem, {})
        content = json.loads(data)
        if not assess(content)['constraint_screen_passed']:
            continue
        expected_cases = len(content['problem']['examples']) + len(content['hiddenCases'])
        if (s.get('sha256') != digest or s.get('error') != '' or h.get('sha256') != digest
                or h.get('status') != 'passed' or h.get('cases') != expected_cases):
            continue
        (args.output / path.name).write_bytes(data)
        fixtures.append({'file': path.name, 'sha256': digest, 'leetcodeId': content['problem'].get('leetcodeId')})
    manifest = {
        'candidate_count': candidate_count,
        'fixture_count': len(fixtures),
        'sources': sources,
        'corpus': corpus,
        'limitations': ['Generated cases are public and are not secret LeetCode tests', 'The constraint screen and reference agreement do not prove correctness or resolve every ambiguous output'],
        'fixtures': fixtures,
    }
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Exported {len(fixtures)} structurally valid, reference-checked fixtures')


if __name__ == '__main__':
    main()
