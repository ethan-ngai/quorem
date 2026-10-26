import unittest

from scripts.leetcode_statement import format_question


class StatementTest(unittest.TestCase):
    def content(self):
        return {'problem': {'statementMarkdown': 'old', 'examples': [{'args': [[1]], 'expected': 1}, {'args': [[2]], 'expected': 2}]}}

    def test_html_code_math_examples_and_followup(self):
        html = '''<p>Given <code>nums[i]</code> and <code>10<sup>5</sup></code>, find <strong>the <em>answer</em></strong>.</p>
<p><strong>Example 1:</strong></p><pre><strong>Input:</strong> nums = [1]
<strong>Output:</strong> 1
<strong>Explanation:</strong> <code>nums[0]</code> is 1.</pre>
<p><strong class="example">Example 2:</strong></p><p><strong>Input:</strong> <code>nums = [2]</code></p><p><strong>Output:</strong> 2</p><p><strong>Explanation:</strong> Return <code>2</code>.</p>
<p><strong>Constraints:</strong></p><ul><li><code>1 &lt;= n &lt;= 10<sup>5</sup></code></li></ul><p><strong>Follow-up:</strong> Use <code>O(n)</code>.</p>'''
        result = format_question(self.content(), html)['problem']
        self.assertIn('`nums[i]`', result['statementMarkdown'])
        self.assertIn('`10^5`', result['statementMarkdown'])
        self.assertIn('**the *answer***', result['statementMarkdown'])
        self.assertIn('Follow-up:', result['statementMarkdown'])
        self.assertNotIn('Example 1', result['statementMarkdown'])
        self.assertEqual(result['examples'][0]['explanation'], '`nums[0]` is 1.')
        self.assertEqual(result['examples'][1]['explanation'], 'Return `2`.')

    def test_ambiguous_boundary_never_drops_original(self):
        original = self.content()
        html = '<p>Intro.</p><p><strong>Example 1:</strong></p><pre>Input: [1]\nOutput: 1</pre><p>Follow-up.</p>'
        with self.assertRaises(ValueError):
            format_question(original, html)
        self.assertEqual(original['problem']['statementMarkdown'], 'old')

    def test_multiline_explanation_and_table_are_retained(self):
        content = {'problem': {'statementMarkdown': 'old', 'examples': [{'args': [1], 'expected': 2}]}}
        html = '<p><code>x</code> is a value.</p><p><strong>Example 1:</strong></p><div><p><strong>Input:</strong> x = 1</p><p><strong>Output:</strong> 2</p><p><strong>Explanation:</strong> See below.</p></div><table><tr><th>x</th><th>y</th></tr><tr><td>1</td><td>2</td></tr></table><p><strong>Constraints:</strong></p><p>None.</p>'
        result = format_question(content, html)['problem']
        self.assertIn('See below.', result['examples'][0]['explanation'])
        self.assertIn('1 | 2 |', result['examples'][0]['explanation'])
        self.assertNotIn('See below.', result['statementMarkdown'])


if __name__ == '__main__':
    unittest.main()
