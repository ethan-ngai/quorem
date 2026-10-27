#!/usr/bin/env python3
"""Stage more sourced cases, subject to constraint and sandbox checks."""
import argparse
import hashlib
import importlib.util
import json
import subprocess
from collections import Counter
from pathlib import Path

from audit_leetcode_cases import assess

spec = importlib.util.spec_from_file_location('prepare_leetcode_drafts', Path(__file__).with_name('prepare-leetcode-drafts.py'))
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)

CORPUS = {
    'train': 'ef7d64d34b092859607c1010bdd23540860a8cfff2ed7aeb0fe82e0ad524919b',
    'test': 'aec951945feb555b4c72783519452a7a0437ca8c6e5624a83d0ae888718fa4ed',
}


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''): result.update(block)
    return result.hexdigest()


def fixtures(directory):
    result = {}
    for path in sorted(directory.glob('[0-9]*.json')):
        data = path.read_bytes()
        content = json.loads(data)
        if path.name != f"{content['problem']['leetcodeId']}.json": raise ValueError('fixture identity mismatch')
        result[path.stem] = {'path': path, 'sha256': hashlib.sha256(data).hexdigest(), 'content': content}
    return result


def corpus_rows(paths, needed):
    rows, duplicates = {}, set()
    by_slug = {entry['content']['problem']['slug'].removeprefix('lc-'): id for id, entry in needed.items()}
    if len(by_slug) != len(needed): raise ValueError('duplicate fixture slug')
    for split, path in paths.items():
        if digest(path) != CORPUS[split]: raise ValueError(f'{split} corpus hash mismatch')
        with path.open(encoding='utf-8') as f:
            for line in f:
                row = json.loads(line)
                id = by_slug.get(row.get('task_id'))
                if id is None: continue
                if id in rows: duplicates.add(id)
                rows[id] = {'record': row, 'split': split}
    for id in duplicates: del rows[id]
    return rows


def candidate_cases(content, row):
    signature = content['problem']['signature']
    existing = content['problem']['examples'] + content['hiddenCases']
    seen = {json.dumps(item['args'], sort_keys=True): item.get('expected') for item in existing}
    candidates, counts, source_indexes = [], Counter(), {}
    for index, raw in enumerate(row.get('input_output', [])):
        try:
            case = prepare.case(raw, signature['parameters'])
            if not prepare.checked_case(case, signature): raise ValueError('case type mismatch')
        except (SyntaxError, ValueError, TypeError, KeyError, RecursionError):
            counts['unparseable_or_type_invalid'] += 1
            continue
        key = json.dumps(case['args'], sort_keys=True)
        if key in seen:
            counts['conflicting_existing'] += seen[key] != case['expected']
            counts['duplicate'] += seen[key] == case['expected']
            continue
        seen[key] = case['expected']
        probe = dict(content, hiddenCases=[*content['hiddenCases'], case])
        check = assess(probe)
        if any(item['index'] == len(content['hiddenCases']) for item in check['rejected']):
            counts['violates_parsed_constraint'] += 1
            continue
        candidates.append(case)
        source_indexes[json.dumps(case, sort_keys=True)] = index
        if len(candidates) == 80: break
    return candidates, dict(counts), source_indexes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('fixtures', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--train', type=Path, required=True)
    parser.add_argument('--test', type=Path, required=True)
    parser.add_argument('--image', default='quorem-python:local')
    args = parser.parse_args()
    if args.output.exists(): parser.error('output already exists')
    all_items = fixtures(args.fixtures)
    needed = {id: item for id, item in all_items.items() if len(item['content']['hiddenCases']) < 20}
    rows = corpus_rows({'train': args.train, 'test': args.test}, needed)
    jobs, reports, source_indexes = [], {}, {}
    for id, entry in needed.items():
        content = entry['content']
        check = assess(content)
        report = {'id': id, 'input_sha256': entry['sha256'], 'unsupported_constraints': check['unsupported'], 'known_bad_reference': check['known_bad_reference'], 'original_case_count': len(content['hiddenCases'])}
        reports[id] = report
        record = rows.get(id)
        if check['known_bad_reference'] or check['invalid_examples']:
            report['status'] = 'blocked_reference_or_example'
            continue
        if not record or str(record['record'].get('question_id')) != id:
            report['status'] = 'missing_or_conflicting_corpus_identity'
            continue
        report['corpus_split'] = record['split']
        cases, counts, source_indexes[id] = candidate_cases(content, record['record'])
        report['candidate_filter_counts'] = counts
        report['candidate_count'] = len(cases)
        if not cases:
            report['status'] = 'no_eligible_source_cases'
            continue
        jobs.append({'id': id, 'needed': 20 - len(content['hiddenCases']), 'signature': content['problem']['signature'], 'reference': content['implementations'][0]['referenceSource'], 'candidates': cases})
    if jobs:
        worker = Path(__file__).with_name('replenish-leetcode-worker.py').resolve()
        command = ['docker', 'run', '--rm', '-i', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '512m', '--pids-limit', '64', '--cpus', '4', '--user', '65534:65534', '-v', f'{worker}:/worker.py:ro', '--entrypoint', 'python', args.image, '/worker.py']
        proc = subprocess.run(command, input=json.dumps(jobs), capture_output=True, text=True, check=True, timeout=1800)
        results = json.loads(proc.stdout)
        if len(results) != len(jobs) or {r['id'] for r in results} != {job['id'] for job in jobs}: raise ValueError('incomplete sandbox results')
    else:
        results = []
    for entry in all_items.values():
        if digest(entry['path']) != entry['sha256']: raise ValueError('fixture changed while validating')
    args.output.mkdir(parents=True)
    candidates = args.output / 'candidates'
    candidates.mkdir()
    for result in results:
        id = result['id']
        content = needed[id]['content']
        content['hiddenCases'].extend(result['accepted'])
        report = reports[id]
        report.update({'accepted_count': len(result['accepted']), 'accepted_source_indexes': [source_indexes[id][json.dumps(case, sort_keys=True)] for case in result['accepted']], 'reference_disagreements': len(result['failed']), 'remaining_case_count': len(content['hiddenCases']), 'status': 'full' if len(content['hiddenCases']) == 20 else 'underfilled'})
        if result['accepted']:
            data = (json.dumps(content, ensure_ascii=False, indent=2) + '\n').encode()
            (candidates / f'{id}.json').write_bytes(data)
            report['output_sha256'] = hashlib.sha256(data).hexdigest()
    report = {'corpus_revision': prepare.REVISION, 'corpus_sha256': CORPUS, 'total_underfilled': len(needed), 'full': sum(v.get('status') == 'full' for v in reports.values()), 'changed': sum('output_sha256' in v for v in reports.values()), 'limitations': ['Source cases and expected outputs are publicly available, not secret.', 'Agreement with the existing reference is not independent proof of correctness.', 'Unsupported constraints and known bad references remain review-only.'], 'items': list(reports.values())}
    (args.output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(f"Staged {report['changed']} changed questions; {report['full']} now have 20 cases. Constraint and reference review still required.")


if __name__ == '__main__': main()
