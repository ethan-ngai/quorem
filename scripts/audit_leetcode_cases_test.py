import unittest
from audit_leetcode_cases import assess, parse_bound, value_satisfies


class QualityTest(unittest.TestCase):
    def test_bounds(self):
        names = ['nums', 'k', 'grid']
        rules = [parse_bound(t, names) for t in ('1 <= nums.length <= 10^5', '2 <= nums[i] <= 1000', '0 <= grid[i][j] <= 100', '1 <= k < 10')]
        self.assertTrue(all(rules))
        args = {'nums': [2, 50], 'k': 2, 'grid': [[1, 100], [0, 3]]}
        self.assertTrue(all(value_satisfies(r, args) for r in rules))
        self.assertFalse(value_satisfies(rules[1], dict(args, nums=[1024])))
        self.assertFalse(value_satisfies(rules[2], dict(args, grid=[[101]])))
        self.assertFalse(value_satisfies(rules[0], dict(args, nums=[])))
        self.assertFalse(value_satisfies(rules[3], dict(args, k=10)))

    def test_unparsed_constraints_and_duplicates_are_never_silently_approved(self):
        content = {'problem': {'leetcodeId': 1, 'signature': {'parameters': [{'name': 'nums'}]}, 'examples': [{'args': [[2]], 'expected': 1}], 'constraints': [{'kind': 'prose', 'text': '`1 <= nums.length <= 3`'}, {'kind': 'prose', 'text': 'All elements are distinct.'}]}, 'hiddenCases': [{'args': [[2]], 'expected': 1}, {'args': [[]], 'expected': 0}, {'args': [[3]], 'expected': 2}], 'implementations': [{'referenceSource': 'pass'}]}
        report = assess(content)
        self.assertEqual(len(report['cases']), 1)
        self.assertEqual(len(report['rejected']), 2)
        self.assertEqual(report['unsupported'], ['All elements are distinct.'])
        self.assertFalse(report['constraint_screen_passed'])

    def test_unsupported_arithmetic_is_not_executed(self):
        self.assertIsNone(parse_bound("1 <= x <= __import__('os')", ['x']))
        self.assertIsNone(parse_bound('1 <= x <= 10^100000', ['x']))

    def test_rectangular_source_rule(self):
        rule = parse_bound('n == accounts[i].length', ['accounts'])
        self.assertTrue(value_satisfies(rule, {'accounts': [[1, 2], [3, 4]]}))
        self.assertFalse(value_satisfies(rule, {'accounts': [[1, 2], [3]]}))

    def test_conflicting_expected_outputs_require_review(self):
        content = {'problem': {'signature': {'parameters': [{'name': 'n'}]}, 'examples': [{'args': [1], 'expected': 1}], 'constraints': [{'kind': 'prose', 'text': '0 <= n <= 9'}]}, 'hiddenCases': [{'args': [1], 'expected': 2}], 'implementations': [{'referenceSource': 'pass'}]}
        report = assess(content)
        self.assertEqual(report['rejected'][0]['reason'], 'conflicting expected output')
        self.assertIn('conflicting expected output', report['unsupported'])


if __name__ == '__main__':
    unittest.main()
