from question_content import canonical_implementation
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('iterative', Path(__file__).with_name('prepare-recursive-alternatives.py'))
iterative = importlib.util.module_from_spec(spec)
spec.loader.exec_module(iterative)


class CandidateTest(unittest.TestCase):
    def test_reference_replaced_and_python2_compatibility_is_minimal(self):
        fixture = {'problem': {'slug': 'lc-example'}, 'implementations': [{'language': 'python'}], 'canonicalApproachId': 'default', 'approaches': [{'id': 'default', 'title': '', 'defaultLanguage': 'python', 'explanationMarkdown': '', 'timeComplexity': '', 'spaceComplexity': '', 'complexityNotes': '', 'implementations': [{'language': 'python', 'source': 'original'}]}],  'attribution': 'source'}
        source = 'class Solution:\n    def f(self, x):\n        return sum(xrange(x))\n'
        result = iterative.candidate(fixture, source)
        reference = canonical_implementation(result)['source']
        self.assertEqual(reference, 'xrange = range\n\n' + source)
        self.assertEqual(canonical_implementation(result)['source'], reference)
        self.assertIn(iterative.PIN_FILE + 'example.py', result['attribution'])

    def test_preserves_additional_editorials(self):
        fixture = {'problem': {'slug': 'lc-example'}, 'canonicalApproachId': 'default', 'approaches': [{'id': 'default', 'title': '', 'defaultLanguage': 'python', 'explanationMarkdown': '', 'timeComplexity': '', 'spaceComplexity': '', 'complexityNotes': '', 'implementations': [{'language': 'java', 'source': 'independent'}, {'language': 'python', 'source': 'old'}]}],
                    'attribution': ''}
        result = iterative.candidate(fixture, 'class Solution: pass\n')
        self.assertEqual(next(i for i in result['approaches'][0]['implementations'] if i['language'] == 'java')['source'], 'independent')

    def test_only_needed_standard_bindings_are_added(self):
        fixture = {'problem': {'slug': 'lc-example'}, 'implementations': [{'language': 'python'}], 'canonicalApproachId': 'default', 'approaches': [{'id': 'default', 'title': '', 'defaultLanguage': 'python', 'explanationMarkdown': '', 'timeComplexity': '', 'spaceComplexity': '', 'complexityNotes': '', 'implementations': [{'language': 'python', 'source': 'original'}]}],  'attribution': ''}
        source = 'class Solution:\n    def f(self, values):\n        return Counter(values)\n'
        reference = canonical_implementation(iterative.candidate(fixture, source))['source']
        self.assertEqual(reference, 'from typing import Counter\n\n' + source)

    def test_selects_first_upstream_solution_and_converts_only_izip(self):
        source = 'import itertools\nimport bisect\nclass Solution:\n def jobScheduling(self, x):\n  return bisect.bisect_right(list(itertools.izip(x, x)), (0, 0))\nclass Solution:\n def jobScheduling(self, x):\n  return -1\n'
        body, bindings = iterative.selected_source(1235, source)
        self.assertEqual(bindings, {'bisect'})
        self.assertIn('import bisect', body)
        self.assertIn('zip(x, x)', body)
        self.assertNotIn('itertools', body)
        self.assertNotIn('return -1', body)
        with self.assertRaises(ValueError):
            iterative.selected_source(1235, source.replace('itertools.izip', 'zip'))

    def test_rejects_unexpected_class_layout(self):
        with self.assertRaises(ValueError):
            iterative.selected_source(2477, 'class Solution: pass\n')


if __name__ == '__main__':
    unittest.main()
