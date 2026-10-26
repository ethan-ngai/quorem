import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("drafts", Path(__file__).with_name("prepare-leetcode-drafts.py"))
drafts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(drafts)


class DraftTest(unittest.TestCase):
    def test_signature_and_literal_cases(self):
        sig = drafts.signature('class Solution:\n    def total(self, nums: List[int], k: int) -> int:\n        ')
        self.assertEqual(sig['parameters'], [{'name': 'nums', 'type': 'list<int>'}, {'name': 'k', 'type': 'int'}])
        self.assertEqual(drafts.case({'input': 'k = 3, nums = [1, 2]', 'output': '6'}, sig['parameters']), {'args': [[1, 2], 3], 'expected': 6})

    def test_never_executes_case_expressions(self):
        with self.assertRaises(ValueError):
            drafts.case({'input': 'x = __import__("os")', 'output': '0'}, [{'name': 'x', 'type': 'int'}])
        with self.assertRaises(ValueError):
            drafts.signature('class Solution:\n    def go(self, x: Dict[str, int]) -> int:\n        ')

    def test_incomplete_draft_has_no_public_examples(self):
        item = {'source': {'problem_slug': 'sample', 'title': 'Sample', 'difficulty': 'Easy'}}
        corpus = {'starter_code': 'class Solution:\n    def solve(self, x: int) -> int:\n        ', 'input_output': [{'input': 'x = 1', 'output': '2'}], 'problem_description': 'Statement', 'completion': 'class Solution: pass'}
        result = drafts.draft(item, corpus)
        self.assertEqual(result['problem']['examples'], [])
        self.assertEqual(result['hiddenCases'], [{'args': [1], 'expected': 2}])

    def test_candidates_require_distinct_typed_cases_and_clear_scalar_output(self):
        item = {'source': {'problem_slug': 'sample', 'title': 'Sample', 'difficulty': 'Easy', 'examples': [{'example_text': 'Input: x = 0\nOutput: 1'}]}}
        corpus = {'starter_code': 'class Solution:\n    def solve(self, x: int) -> int:\n        ', 'input_output': [{'input': f'x = {i}', 'output': str(i + 1)} for i in range(21)], 'problem_description': 'Return the sum.', 'completion': 'class Solution: pass'}
        content = drafts.draft(item, corpus)
        candidate = drafts.candidate(content, item['source'], corpus)
        self.assertEqual(candidate['problem']['examples'], [{'args': [0], 'expected': 1}])
        self.assertEqual(len(candidate['hiddenCases']), 20)
        self.assertNotIn(candidate['problem']['examples'][0], candidate['hiddenCases'])
        content['problem']['statementMarkdown'] = 'Return any valid answer.'
        with self.assertRaises(ValueError):
            drafts.candidate(content, item['source'], corpus)


if __name__ == '__main__':
    unittest.main()
