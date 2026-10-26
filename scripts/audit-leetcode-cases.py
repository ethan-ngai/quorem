#!/usr/bin/env python3
"""Screen candidate cases and write a report; output is not publication-ready."""
import argparse
import json
from pathlib import Path

from audit_leetcode_cases import assess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('candidates', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    if args.output.exists(): parser.error('output already exists')
    args.output.mkdir(parents=True)
    cleaned = args.output / 'candidates'
    cleaned.mkdir()
    screened = args.output / 'constraint-screen-passed'
    screened.mkdir()
    reports = []
    for path in sorted(args.candidates.glob('[0-9]*.json')):
        content = json.loads(path.read_text())
        result = assess(content)
        content['hiddenCases'] = result.pop('cases')
        reports.append({'id': path.stem, **result, 'remaining_cases': len(content['hiddenCases'])})
        serialized = json.dumps(content, ensure_ascii=False, indent=2) + '\n'
        (cleaned / path.name).write_text(serialized)
        if result['constraint_screen_passed']:
            (screened / path.name).write_text(serialized)
    summary = {'total': len(reports),
               'unsupported_constraints': sum(bool(r['unsupported']) for r in reports),
               'known_bad_references': [r['id'] for r in reports if r['known_bad_reference']],
               'rejected_cases': sum(len(r['rejected']) for r in reports),
               'constraint_screen_passed': sum(r['constraint_screen_passed'] for r in reports),
               'limitations': ['Passing this screen does not verify source constraints, expected outputs, or reference correctness.', 'Do not publish output without independent validation and full constraint review.'],
               'items': reports}
    (args.output / 'report.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
    print(f"Screened {len(reports)}; {summary['rejected_cases']} duplicate or out-of-bounds cases removed; {summary['unsupported_constraints']} require constraint review")


if __name__ == '__main__':
    main()
