import unittest
from audit_leetcode_cases import assess, parse_bound, parse_extra, value_satisfies


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
        self.assertTrue(value_satisfies(parse_bound('cols == pizza[i].length', ['pizza']), {'pizza': ['A..', 'AAA']}))

    def test_conflicting_expected_outputs_require_review(self):
        content = {'problem': {'signature': {'parameters': [{'name': 'n'}]}, 'examples': [{'args': [1], 'expected': 1}], 'constraints': [{'kind': 'prose', 'text': '0 <= n <= 9'}]}, 'hiddenCases': [{'args': [1], 'expected': 2}], 'implementations': [{'referenceSource': 'pass'}]}
        report = assess(content)
        self.assertEqual(report['rejected'][0]['reason'], 'conflicting expected output')
        self.assertIn('conflicting expected output', report['unsupported'])

    def test_comparisons_and_row_lengths(self):
        names = ['nums', 'k', 'n', 'edges']
        values = {'nums': [1, 2, 3], 'k': 2, 'n': 3, 'edges': [[0, 1], [1, 2]]}
        for text in ('1 <= k <= nums.length', 'n == nums.length', 'edges[i].length == 2', '1 <= k, n <= 10^5', '0 <= k < n', '0 <= n <= 2^31 - 1'):
            rule = parse_extra(text, names)
            self.assertIsNotNone(rule, text)
            self.assertTrue(value_satisfies(rule, values), text)
        self.assertFalse(value_satisfies(parse_extra('n == nums.length', names), dict(values, n=4)))
        self.assertFalse(value_satisfies(parse_extra('edges[i].length == 2', names), dict(values, edges=[[1]])))
        self.assertFalse(value_satisfies(parse_extra('1 <= k, n <= 10', names), dict(values, k=11)))

    def test_first_row_length(self):
        rule = parse_extra('1 <= matrix[0].length <= 3', ['matrix'])
        self.assertIsNotNone(rule)
        self.assertTrue(value_satisfies(rule, {'matrix': [[1, 2], []]}))
        self.assertFalse(value_satisfies(rule, {'matrix': [[]]}))
        self.assertFalse(value_satisfies(rule, {'matrix': []}))
        self.assertFalse(value_satisfies(rule, {'matrix': [1]}))
        self.assertIsNone(parse_extra('matrix[-1].length <= 3', ['matrix']))

    def test_each_row_length_bound(self):
        rule = parse_extra('1 <= words[i].length <= 3', ['words'])
        self.assertIsNotNone(rule)
        self.assertTrue(value_satisfies(rule, {'words': ['a', 'abc']}))
        self.assertFalse(value_satisfies(rule, {'words': ['a', '']}))
        self.assertFalse(value_satisfies(rule, {'words': ['abcd']}))
        self.assertFalse(value_satisfies(rule, {'words': [1]}))
        self.assertIsNone(parse_extra('words[i].length <= 3', ['words', 'i']))

    def test_lowercase_english_only_and_unsupported_expressions(self):
        rule = parse_extra('`s` consists of only lowercase English letters.', ['s'])
        self.assertTrue(value_satisfies(rule, {'s': 'abc'}))
        self.assertFalse(value_satisfies(rule, {'s': 'é'}))
        self.assertFalse(value_satisfies(rule, {'s': 'Ab'}))
        upper = parse_extra('`tiles` consists of uppercase English letters.', ['tiles'])
        words = parse_extra('`words[i]` consists only of lowercase English letters.', ['words'])
        self.assertTrue(value_satisfies(upper, {'tiles': 'AZ'}))
        self.assertFalse(value_satisfies(upper, {'tiles': 'Az'}))
        self.assertTrue(value_satisfies(words, {'words': ['abc', 'xyz']}))
        self.assertFalse(value_satisfies(words, {'words': ['abc', 'X']}))
        self.assertFalse(value_satisfies(words, {'words': 'abc'}))
        self.assertIsNone(parse_extra('words[i] consists of lowercase English letters.', ['words', 'i']))
        self.assertIsNone(parse_extra('1 <= x <= __import__("os").system("true")', ['x']))
        self.assertIsNone(parse_extra('1 <= x <= 10^100000', ['x']))
        self.assertIsNone(parse_extra('n == nums.length', ['nums']))

    def test_explicit_unique_and_ordered_rules(self):
        names = ['nums', 'days']
        unique = parse_extra('All the elements of `nums` are **unique**.', names)
        ordered = parse_extra('`days` is in strictly increasing order.', names)
        self.assertTrue(value_satisfies(unique, {'nums': [1, 2]}))
        self.assertFalse(value_satisfies(unique, {'nums': [1, 1]}))
        self.assertTrue(value_satisfies(ordered, {'days': [1, 2]}))
        self.assertFalse(value_satisfies(ordered, {'days': [1, 1]}))
        self.assertIsNone(parse_extra('The largest element in nums is unique.', names))

    def test_explicit_length_alias_is_bound_from_input(self):
        content = {'problem': {'signature': {'parameters': [{'name': 'nums'}]}, 'examples': [], 'constraints': [{'kind': 'prose', 'text': 'n == nums.length'}, {'kind': 'prose', 'text': '1 <= n <= 3'}]}, 'hiddenCases': [{'args': [[1, 2]], 'expected': 1}, {'args': [[1, 2, 3, 4]], 'expected': 2}], 'implementations': [{'referenceSource': 'pass'}]}
        report = assess(content)
        self.assertEqual(len(report['cases']), 1)
        self.assertEqual(report['unsupported'], [])
        self.assertEqual(report['rejected'][0]['reason'], 'violates parsed constraint')

    def test_element_bounds_and_chained_length_aliases(self):
        content = {'problem': {'signature': {'parameters': [{'name': 'nums1'}, {'name': 'nums2'}]}, 'examples': [], 'constraints': [{'kind': 'prose', 'text': 'n == nums1.length == nums2.length'}, {'kind': 'prose', 'text': '1 <= nums1[i] <= n'}]}, 'hiddenCases': [{'args': [[1, 2], [3, 4]], 'expected': 1}, {'args': [[1, 3], [3, 4]], 'expected': 2}, {'args': [[1, 2], [3]], 'expected': 3}], 'implementations': [{'referenceSource': 'pass'}]}
        report = assess(content)
        self.assertEqual(len(report['cases']), 1)
        self.assertEqual(len(report['rejected']), 2)
        self.assertEqual(report['unsupported'], [])
        self.assertIsNone(parse_extra('nums1[i] < nums1[j]', ['nums1']))
        self.assertIsNone(parse_extra('manager[headID] == -1', ['manager', 'headID']))
        self.assertIsNone(parse_extra('nums1[i] == 1', ['nums1', 'i']))

    def test_fractional_values_respect_integer_bounds(self):
        rule = parse_bound('1 <= hour <= 10^9', ['hour'])
        self.assertTrue(value_satisfies(rule, {'hour': 2.7}))
        self.assertFalse(value_satisfies(rule, {'hour': float('inf')}))

    def test_public_example_conflict_blocks_screen(self):
        content = {'problem': {'signature': {'parameters': [{'name': 'x'}]}, 'examples': [{'args': [4], 'expected': 1}], 'constraints': [{'kind': 'prose', 'text': '0 <= x < 4'}]}, 'hiddenCases': [], 'implementations': [{'referenceSource': 'pass'}]}
        report = assess(content)
        self.assertEqual(report['invalid_examples'][0]['index'], 0)
        self.assertIn('public example violates parsed constraint', report['unsupported'])


if __name__ == '__main__':
    unittest.main()
