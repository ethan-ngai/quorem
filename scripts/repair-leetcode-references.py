#!/usr/bin/env python3
"""Stage sourced replacements for three known bad references; never publish them."""
import argparse
import hashlib
import io
import json
import random
import subprocess
import tempfile
import tokenize
import urllib.request
from pathlib import Path

from audit_leetcode_cases import FAILING_REFERENCES

KAMYU = '250c3e8ccc6d40db557684ccb66035d863e72896'
SOURCES = {
    '1254': ('https://raw.githubusercontent.com/stbrumme/leetcode/fde5946d9c570f7b1a3eb6386ffe9b74c64667f5/1254.py', '7a36edaab64dd73dadf492f2c284b65f37dbdfab21a529b840bed0847f43d2ec'),
    '1376': (f'https://raw.githubusercontent.com/kamyu104/LeetCode-Solutions/{KAMYU}/Python/time-needed-to-inform-all-employees.py', 'b0be90d61e3e944508276e38b485c39846455a403e680b647a12a3ecb65b5f54'),
    '2472': (f'https://raw.githubusercontent.com/kamyu104/LeetCode-Solutions/{KAMYU}/Python/maximum-number-of-non-overlapping-palindrome-substrings.py', '54554b3b5715a501e09fac3670c7659ae4ef2ae45b642c15bf22b91da2e9d2f6'),
}


def fetch(url, expected):
    with urllib.request.urlopen(url, timeout=30) as response:
        data = response.read(65537)
    if len(data) > 65536 or hashlib.sha256(data).hexdigest() != expected:
        raise ValueError('source hash mismatch or size limit')
    return data.decode('utf-8')


def python3_source(source):
    tokens = list(tokenize.generate_tokens(io.StringIO(source).readline))
    result = [tokenize.TokenInfo(t.type, 'range' if t.type == tokenize.NAME and t.string == 'xrange' else t.string, t.start, t.end, t.line) for t in tokens]
    return tokenize.untokenize(result)


def valid_inform_case(case):
    try:
        n, head, manager, times = case['args']
        if not (type(n) is int and type(head) is int and 1 <= n <= 100000 and 0 <= head < n and len(manager) == len(times) == n and manager[head] == -1): return False
        if not all(type(v) is int and 0 <= v < n for i, v in enumerate(manager) if i != head): return False
        if not all(type(v) is int and 0 <= v <= 1000 for v in times): return False
        parents = set(manager)
        if any(times[i] != 0 for i in range(n) if i not in parents): return False
        children = [[] for _ in range(n)]
        for i, parent in enumerate(manager):
            if i != head: children[parent].append(i)
        seen, stack = {head}, [head]
        while stack:
            for child in children[stack.pop()]:
                if child in seen: return False
                seen.add(child)
                stack.append(child)
        return len(seen) == n
    except (TypeError, ValueError, IndexError, KeyError):
        return False


def valid_case(id, case):
    try:
        if id == '1254':
            grid, = case['args']
            return (isinstance(grid, list) and 1 <= len(grid) <= 100 and
                    all(isinstance(row, list) and 1 <= len(row) <= 100 and len(row) == len(grid[0]) and
                        all(type(value) is int and value in (0, 1) for value in row) for row in grid))
        if id == '1376': return valid_inform_case(case)
        text, k = case['args']
        return isinstance(text, str) and text.isascii() and text.isalpha() and text.islower() and type(k) is int and 1 <= k <= len(text) <= 2000
    except (TypeError, ValueError, IndexError, KeyError):
        return False


def generated_inputs(id, seed):
    rng = random.Random(seed)
    for _ in range(96):
        if id == '1254':
            rows, cols = rng.randint(1, 8), rng.randint(1, 8)
            yield [[[rng.randrange(2) for _ in range(cols)] for _ in range(rows)]]
        elif id == '1376':
            n = rng.randint(1, 80)
            order = list(range(n))
            rng.shuffle(order)
            manager = [-1] * n
            for i in range(1, n): manager[order[i]] = order[rng.randrange(i)]
            parents = set(manager)
            times = [rng.randint(0, 1000) if i in parents else 0 for i in range(n)]
            yield [n, order[0], manager, times]
        else:
            n = rng.randint(1, 32)
            yield [''.join(rng.choice('abcde') for _ in range(n)), rng.randint(1, n)]


def agree_in_sandbox(image, signature, sources, cases):
    validator = Path(__file__).with_name('leetcode-reference-agreement.py').resolve()
    command = ['docker', 'run', '--rm', '-i', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '512m', '--pids-limit', '64', '--cpus', '2', '--user', '65534:65534', '-v', f'{validator}:/agreement.py:ro', '--entrypoint', 'python', image, '/agreement.py']
    payload = {'signature': signature, 'sources': sources, 'cases': cases}
    process = subprocess.run(command, input=json.dumps(payload), check=True, capture_output=True, text=True, timeout=300)
    return json.loads(process.stdout)


def boundary(id):
    if id == '1254':
        grid = [[1 if i in (0, 39) or j in (0, 39) else 0 for j in range(40)] for i in range(40)]
        return {'args': [grid], 'expected': 1}
    if id == '1376':
        n = 1200
        return {'args': [n, 0, [-1] + list(range(n - 1)), [1] * (n - 1) + [0]], 'expected': n - 1}
    return {'args': ['a' * 1500, 2], 'expected': 750}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('fixtures', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--image', default='quorem-python:local')
    args = parser.parse_args()
    if args.output.exists(): parser.error('output already exists')
    outputs = {}
    with tempfile.TemporaryDirectory(prefix='quorem-ref-check-') as temp:
        root = Path(temp)
        for id, (url, expected_hash) in SOURCES.items():
            content = json.loads((args.fixtures / f'{id}.json').read_text())
            old = content['implementations'][0]['referenceSource']
            if hashlib.sha256(old.encode()).hexdigest() != FAILING_REFERENCES[id]:
                raise ValueError(f'{id}: original reference changed')
            source = python3_source(fetch(url, expected_hash))
            if id == '1254': source = 'from typing import List\n\n' + source
            content['implementations'][0]['referenceSource'] = source
            content['solutions'] = [{'language': 'python', 'source': source, 'explanationMarkdown': '', 'timeComplexity': '', 'spaceComplexity': '', 'complexityNotes': ''}]
            content['attribution'] += f' Reference solution: {url}.'
            before = len(content['hiddenCases'])
            if not all(valid_case(id, c) for c in content['problem']['examples']): raise ValueError(f'invalid {id} public example')
            seen = {json.dumps(c['args']) for c in content['problem']['examples']}
            retained = []
            for case in content['hiddenCases']:
                key = json.dumps(case['args'])
                if key not in seen and valid_case(id, case):
                    retained.append(case)
                    seen.add(key)
            removed = before - len(retained)
            needed = 20 - len(retained)
            if needed:
                generated = []
                for values in generated_inputs(id, int(id)):
                    key = json.dumps(values)
                    if key not in seen and valid_case(id, {'args': values}):
                        generated.append(values)
                        seen.add(key)
                        if len(generated) >= needed * 5 + 10: break
                agreed = agree_in_sandbox(args.image, content['problem']['signature'], [old, source], generated)
                if len(agreed) < needed: raise ValueError(f'{id}: not enough independently agreed valid cases')
                retained.extend(agreed[:needed])
            content['hiddenCases'] = retained
            outputs[id] = {'content': content, 'removed': removed, 'replenished': needed, 'seed': int(id), 'url': url, 'source_sha256': expected_hash}
            test = json.loads(json.dumps(content))
            test['hiddenCases'].append(boundary(id))
            (root / f'{id}.json').write_text(json.dumps(test))
        validator = Path(__file__).with_name('validate-leetcode-drafts.py').resolve()
        command = ['docker', 'run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '512m', '--pids-limit', '64', '--cpus', '4', '--user', '65534:65534', '-v', f'{root}:/drafts:ro', '-v', f'{validator}:/validate.py:ro', '--entrypoint', 'python', args.image, '/validate.py', '/drafts', '--jobs', '3']
        process = subprocess.run(command, check=True, capture_output=True, text=True, timeout=180)
        results = [json.loads(line) for line in process.stdout.splitlines()]
        if len(results) != len(outputs) or any(r['status'] != 'passed' for r in results):
            raise ValueError('sandbox validation failed: ' + json.dumps(results))
    args.output.mkdir(parents=True)
    for id, item in outputs.items():
        (args.output / f'{id}.json').write_text(json.dumps(item.pop('content'), ensure_ascii=False, indent=2) + '\n')
    (args.output / 'report.json').write_text(json.dumps({'sources': outputs, 'checks': results, 'publication_ready': False, 'limitations': ['Case validity and coverage require full constraint review', 'Fewer than 20 hidden cases cannot be published']}, indent=2) + '\n')
    print('Staged three independently sourced replacements; review case validity and minimum test count before publication.')


if __name__ == '__main__':
    main()
