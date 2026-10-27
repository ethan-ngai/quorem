import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

replenish = load('replenish', 'replenish-leetcode-cases.py')
worker = load('worker', 'replenish-leetcode-worker.py')


class ReplenishTest(unittest.TestCase):
    def fixture(self):
        return {'problem': {'leetcodeId': 1, 'slug': 'lc-example', 'signature': {'className': 'Solution', 'methodName': 'f', 'parameters': [{'name': 'n', 'type': 'int'}], 'returnType': 'int'}, 'constraints': [{'kind': 'prose', 'text': '1 <= n <= 5'}, {'kind': 'prose', 'text': 'n is a prime.'}], 'examples': [{'args': [1], 'expected': 1}]}, 'hiddenCases': [{'args': [2], 'expected': 2}], 'implementations': [{'referenceSource': 'class Solution: pass'}]}

    def test_source_cases_are_filtered_without_claiming_unparsed_prose(self):
        row = {'input_output': [{'input': 'n = 1', 'output': '1'}, {'input': 'n = 2', 'output': '9'}, {'input': 'n = 6', 'output': '6'}, {'input': 'n = 3', 'output': '3'}]}
        cases, counts, indexes = replenish.candidate_cases(self.fixture(), row)
        self.assertEqual(cases, [{'args': [3], 'expected': 3}])
        self.assertEqual(counts['duplicate'], 1)
        self.assertEqual(counts['conflicting_existing'], 1)
        self.assertEqual(counts['violates_parsed_constraint'], 1)
        self.assertEqual(indexes[json.dumps(cases[0], sort_keys=True)], 3)

    def test_wrong_fixture_identity_and_corpus_hash_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / '2.json').write_text(json.dumps(self.fixture()))
            with self.assertRaises(ValueError): replenish.fixtures(folder)
            f = folder / 'bad.jsonl'
            f.write_text('{}')
            with self.assertRaises(ValueError): replenish.corpus_rows({'train': f}, {})

    def test_worker_checks_actual_value_and_preserves_types(self):
        job = {'id': '1', 'needed': 1, 'signature': {}, 'reference': '', 'candidates': [{'args': [1], 'expected': True}, {'args': [2], 'expected': 2}]}
        class Result:
            stdout = b'\0{"status":"executed","actual":2}'
        with patch.object(worker.subprocess, 'run', return_value=Result()):
            result = worker.check(job)
        self.assertEqual(result['accepted'], [{'args': [2], 'expected': 2}])
        self.assertEqual(result['failed'], [[1]])


if __name__ == '__main__': unittest.main()
