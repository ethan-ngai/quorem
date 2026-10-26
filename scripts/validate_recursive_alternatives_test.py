import importlib.util
import json
from pathlib import Path
import tempfile
from unittest.mock import patch
import unittest

spec = importlib.util.spec_from_file_location('boundary', Path(__file__).with_name('validate-recursive-alternatives.py'))
boundary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(boundary)


class BoundaryTest(unittest.TestCase):
    def test_linear_probe_uses_valid_bounds_and_independent_expected(self):
        cases = boundary.boundary_cases()
        args, expected = cases[3249]
        self.assertEqual(len(args[0]), 1499)
        self.assertEqual(args[0][0], [0, 1])
        self.assertEqual(args[0][-1], [1498, 1499])
        self.assertEqual(expected, 1500)
        self.assertEqual(cases[2477][1], 1124250)
        self.assertEqual(cases[1235][1], 1500)
        self.assertEqual(cases[1223][1], 665544190)

    def test_boundary_failure_is_not_a_pass(self):
        fixture = {'problem': {'signature': {}, 'examples': [{'args': [], 'expected': 3}]},
                   'hiddenCases': [], 'implementations': [{'language': 'python', 'referenceSource': 'source'}]}
        class Result:
            def __init__(self, actual):
                self.stdout = json.dumps({'status': 'executed', 'actual': actual}).encode()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / '309.json'
            path.write_text(json.dumps(fixture))
            with patch.object(boundary.subprocess, 'run', side_effect=[Result(3), Result(1)]):
                result = boundary.validate(path)
        self.assertFalse(result['matches'])
        self.assertEqual(result['case'], 2)


if __name__ == '__main__':
    unittest.main()
