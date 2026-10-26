#!/usr/bin/env python3
"""Refresh verified fixtures from cached public HTML into validation candidates."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

from leetcode_statement import format_question

spec = importlib.util.spec_from_file_location('prepare_leetcode_drafts', Path(__file__).with_name('prepare-leetcode-drafts.py'))
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('fixtures', type=Path)
    parser.add_argument('html_cache', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--staged', type=Path, required=True, help='staged source directory with questions.json')
    args = parser.parse_args()
    if args.output.exists():
        parser.error('output already exists')
    manifest = json.loads((args.fixtures / 'manifest.json').read_text())
    staged = {item['leetcode_id']: item for item in json.loads((args.staged / 'questions.json').read_text())}
    records = []
    for item in manifest['fixtures']:
        name = item['file']
        if name != Path(name).name or name != f"{item['leetcodeId']}.json":
            raise ValueError('invalid manifest path')
        data = (args.fixtures / name).read_bytes()
        if hashlib.sha256(data).hexdigest() != item['sha256']:
            raise ValueError('fixture hash mismatch: ' + name)
        records.append((name, json.loads(data)))
    args.output.mkdir(parents=True)
    candidates = args.output / 'candidates'
    candidates.mkdir()
    failures = []
    for name, content in records:
        try:
            record = json.loads((args.html_cache / name).read_text())['question']
            slug = content['problem']['slug'].removeprefix('lc-')
            if str(record.get('questionFrontendId')) != str(content['problem']['leetcodeId']) or record.get('titleSlug') != slug or not record.get('content'):
                raise ValueError('invalid cached question')
            content = format_question(content, record['content'], prepare.case)
            source = staged[content['problem']['leetcodeId']]['source']
            if source['problem_slug'] != slug or not isinstance(source.get('topics'), list):
                raise ValueError('invalid staged source topics')
            content['problem']['tags'] = source['topics']
        except (OSError, ValueError, KeyError, TypeError) as error:
            failures.append({'file': name, 'reason': str(error)})
        (candidates / name).write_text(json.dumps(content, ensure_ascii=False, indent=2) + '\n')
    report = {'corpus': manifest['corpus'], 'formatted': len(records) - len(failures), 'failures': failures}
    (args.output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(f"Formatted {report['formatted']}/{len(records)} fixtures; {len(failures)} require review. Revalidate before export.")


if __name__ == '__main__':
    main()
