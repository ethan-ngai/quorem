#!/usr/bin/env python3
"""Stage pinned iterative reference candidates; validate in the isolated harness before use."""
import argparse
import ast
import hashlib
import importlib.util
import json
from pathlib import Path

PIN = 'https://github.com/kamyu104/LeetCode-Solutions/tree/250c3e8ccc6d40db557684ccb66035d863e72896'
PIN_FILE = 'https://github.com/kamyu104/LeetCode-Solutions/blob/250c3e8ccc6d40db557684ccb66035d863e72896/Python/'
SOURCE_HASHES = {
    1223: 'fb63d05a20dec643313aa68bd3940df94d0dff456175267c65592e34e7c60b99',
    1235: '1491ba24eaf7299c3c1916802cc3b9fd047c6ad07b712a37e0ed13770ff8d421',
    2477: '5cd281c74ff122770891292489a9b28b58ebb440b4616ea042f48f8211f45568',
    3290: 'd2d6649751f915ca9eeb4fd5fcb43141e6e20c1fd787496459159841f405a738',
    1872: '019f5a50b117ddac20392b4fd6ea222e25446580c98486ccbc5a8aa4c140c299',
    2435: 'f6e95f8b3b94d0d12bb2169168134bc754041580b77d7d1ef458908fc31091e8',
    2049: 'e64fe8b961973ce7a93e8cb073d7ab5fa92bedaa4811a89dd20dfc76c87587f8',
    3249: '6575561afbeb437c4f5a57c33d4ab7f3f499c6928ea92cb430a2bc989bee7acf',
    714: '84297eaad6b48a9491b715ca1f2db9318befc9afd86b4def0de255dd429a7783',
    309: 'af2f800db48692956222c8567220749de706d63113dd06ce1280ceae0b130ef0',
    3196: '75df1b4fca3505507e701ee2b591e735f3971d6a2eb4b677e853e7e747574a9b',
    2246: '2fa3746cbf51e56db9d4ccb8d36d61018624e1482acdefb51ef3c8a527db74b2',
    1466: 'c8017aef32d68416169d72b0312ba0016d36f43af5c44ea94c4eb008539a4f5e',
    2316: 'b205adf833c84310dcda33d4facf37e44e5a8116212158fbccb7188b8ae56b14',
    2368: '010678c922f3ffa95ff00ecf9c227aaa63e36943c8ebed2b672d5b8d139020fd',
    2492: '967fc8c3c57e4fcccef9b443751b651fd9b22761bd22328238b47f96b39d023c',
    2522: 'a400bc54752a3f6e8a4464b12cc1a96bca47f65b478d2ba219be3d5240a322b8',
    3117: '6d1c1bfc3bcc7b59adef4b076969236a4e5b0ba0e24dbff0d3d907f739980aa4',
}
PRELUDE = ['import collections', 'import functools', 'import itertools', 'import heapq', 'import bisect', 'import math', 'import operator', 'from collections import *', 'from functools import *', 'from itertools import *', 'from heapq import *', 'from bisect import *', 'from math import *', 'from typing import *']
spec = importlib.util.spec_from_file_location('prepare_leetcode_drafts', Path(__file__).with_name('prepare-leetcode-drafts.py'))
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def selected_source(id, source):
    if id not in (1235, 2477):
        return source, set()
    tree = ast.parse(source)
    classes = [node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'Solution']
    if len(classes) != 2:
        raise ValueError('unexpected source class layout')
    first = classes[0]
    method = 'jobScheduling' if id == 1235 else 'minimumFuelCost'
    if sum(isinstance(node, ast.FunctionDef) and node.name == method for node in first.body) != 1:
        raise ValueError('unexpected source method layout')
    if id == 1235:
        class Py3Zip(ast.NodeTransformer):
            count = 0
            def visit_Attribute(self, node):
                node = self.generic_visit(node)
                if isinstance(node.value, ast.Name) and node.value.id == 'itertools' and node.attr == 'izip':
                    self.count += 1
                    return ast.copy_location(ast.Name(id='zip', ctx=ast.Load()), node)
                return node
        convert = Py3Zip()
        first = convert.visit(first)
        if convert.count != 1:
            raise ValueError('unexpected Python 2 zip usage')
    loaded = {node.id for node in ast.walk(first) if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load)}
    imports = []
    bindings = set()
    for node in tree.body:
        if isinstance(node, ast.Import):
            for alias in node.names:
                name = alias.asname or alias.name.split('.')[0]
                if name in loaded:
                    imports.append(ast.unparse(ast.Import(names=[alias])))
                    bindings.add(name)
    body = '\n'.join(imports) + ('\n\n' if imports else '') + ast.unparse(first) + '\n'
    return body, bindings


def without_bound_imports(prefix, bindings):
    result = []
    for line in prefix.splitlines():
        if not line:
            continue
        node = ast.parse(line).body[0]
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            node.names = [alias for alias in node.names if (alias.asname or alias.name.split('.')[0]) not in bindings]
            if not node.names:
                continue
        result.append(ast.unparse(node))
    return '\n'.join(result) + ('\n\n' if result else '')


def candidate(content, source):
    source, bindings = selected_source(content['problem'].get('leetcodeId'), source)
    tree = ast.parse(source)
    uses_xrange = any(isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load) and node.id == 'xrange' for node in ast.walk(tree))
    prefix = without_bound_imports(prepare.prelude_for_source(PRELUDE, source), bindings)
    # The pinned source targets Python 2; range supplies its lazy xrange semantics.
    prefix += 'xrange = range\n\n' if uses_xrange else ''
    reference = prefix + source
    implementations = [item for item in content['implementations'] if item['language'] == 'python']
    solutions = [item for item in content['solutions'] if item['language'] == 'python']
    if len(implementations) != 1 or len(solutions) != 1 or solutions[0]['source'] != implementations[0]['referenceSource']:
        raise ValueError('unexpected existing Python solution')
    implementations[0]['referenceSource'] = reference
    solutions[0]['source'] = reference
    slug = content['problem']['slug'].removeprefix('lc-')
    if not slug or '/' in slug or '..' in slug:
        raise ValueError('invalid problem slug')
    content['attribution'] += '; Python solution: ' + PIN_FILE + slug + '.py'
    return content


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('fixtures', type=Path)
    parser.add_argument('alternatives', type=Path)
    parser.add_argument('source_report', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    if args.output.exists():
        parser.error('output already exists')
    if json.loads(args.source_report.read_text())['alternative_source'] != PIN:
        raise ValueError('unexpected source revision')
    # Verify every input before creating output, to avoid partially staged sets.
    inputs = []
    for id, expected in SOURCE_HASHES.items():
        raw_source = (args.alternatives / f'{id}.py').read_bytes()
        if digest(raw_source) != expected:
            raise ValueError(f'source hash mismatch: {id}')
        raw_fixture = (args.fixtures / f'{id}.json').read_bytes()
        content = json.loads(raw_fixture)
        if content['problem']['leetcodeId'] != id:
            raise ValueError(f'fixture identity mismatch: {id}')
        out = json.dumps(candidate(content, raw_source.decode()), ensure_ascii=False, indent=2).encode() + b'\n'
        inputs.append((id, raw_fixture, raw_source, out))
    args.output.mkdir()
    report = {'source': PIN, 'candidates': []}
    for id, raw_fixture, raw_source, out in inputs:
        (args.output / f'{id}.json').write_bytes(out)
        report['candidates'].append({'id': id, 'inputSha256': digest(raw_fixture), 'sourceSha256': digest(raw_source), 'outputSha256': digest(out)})
    (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(f'Staged {len(inputs)} candidates; sandbox validation required')


if __name__ == '__main__':
    main()
