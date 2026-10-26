import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('iterative', Path(__file__).with_name('prepare-recursive-alternatives.py'))
iterative = importlib.util.module_from_spec(spec)
spec.loader.exec_module(iterative)


class CandidateTest(unittest.TestCase):
    def test_reference_replaced_and_python2_compatibility_is_minimal(self):
        fixture = {'problem': {'slug': 'lc-example'}, 'implementations': [{'language': 'python', 'referenceSource': 'original'}],
                   'solutions': [{'language': 'python', 'source': 'original'}], 'attribution': 'source'}
        source = 'class Solution:\n    def f(self, x):\n        return sum(xrange(x))\n'
        result = iterative.candidate(fixture, source)
        reference = result['implementations'][0]['referenceSource']
        self.assertEqual(reference, 'xrange = range\n\n' + source)
        self.assertEqual(result['solutions'][0]['source'], reference)
        self.assertIn(iterative.PIN_FILE + 'example.py', result['attribution'])

    def test_refuses_overwriting_an_independent_editorial(self):
        fixture = {'problem': {'slug': 'lc-example'}, 'implementations': [{'language': 'python', 'referenceSource': 'reference'}],
                   'solutions': [{'language': 'python', 'source': 'independent'}], 'attribution': ''}
        with self.assertRaises(ValueError):
            iterative.candidate(fixture, 'class Solution: pass\n')

    def test_only_needed_standard_bindings_are_added(self):
        fixture = {'problem': {'slug': 'lc-example'}, 'implementations': [{'language': 'python', 'referenceSource': 'original'}],
                   'solutions': [{'language': 'python', 'source': 'original'}], 'attribution': ''}
        source = 'class Solution:\n    def f(self, values):\n        return Counter(values)\n'
        reference = iterative.candidate(fixture, source)['solutions'][0]['source']
        self.assertEqual(reference, 'from typing import Counter\n\n' + source)


if __name__ == '__main__':
    unittest.main()
