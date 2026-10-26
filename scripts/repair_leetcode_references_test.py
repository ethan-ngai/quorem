import importlib.util
import itertools
import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
spec = importlib.util.spec_from_file_location('repair', Path(__file__).with_name('repair-leetcode-references.py'))
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)


class RepairTest(unittest.TestCase):
    def test_python3_conversion_is_token_aware(self):
        self.assertEqual(repair.python3_source('xrange(2) # xrange\n'), 'range(2) # xrange\n')

    def test_generated_cases_are_valid_and_deterministic(self):
        for id in ('1254', '1376', '2472'):
            a = list(itertools.islice(repair.generated_inputs(id, int(id)), 10))
            b = list(itertools.islice(repair.generated_inputs(id, int(id)), 10))
            self.assertEqual(a, b)
            self.assertTrue(all(repair.valid_case(id, {'args': args}) for args in a))

    def test_invalid_trees_and_grids_fail(self):
        self.assertFalse(repair.valid_case('1376', {'args': [3, 0, [-1, 2, 1], [0, 0, 0]]}))
        self.assertFalse(repair.valid_case('1376', {'args': [2, 0, [-1, 0], [1, 1]]}))
        self.assertFalse(repair.valid_case('1254', {'args': [[[0, 1], [0]]]}))
        self.assertFalse(repair.valid_case('2472', {'args': ['', 1]}))


if __name__ == '__main__': unittest.main()
