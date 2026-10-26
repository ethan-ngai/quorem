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
        self.assertNotIn('Constraints:', result['statementMarkdown'])
        self.assertEqual(result['constraints'], [{'kind': 'prose', 'text': '`1 <= n <= 10^5`'}])
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
        self.assertIn('| 1 | 2 |', result['examples'][0]['explanation'])
        self.assertNotIn('See below.', result['statementMarkdown'])

    def test_literal_asterisks_and_additional_live_examples(self):
        content = {'problem': {'statementMarkdown': 'old', 'signature': {'parameters': [{'name': 's', 'type': 'str'}]}, 'examples': [{'args': ['a**'], 'expected': 2}]}}
        def parse(row, parameters):
            import ast
            return {'args': [ast.literal_eval(row['input'].split('=', 1)[1].strip())], 'expected': int(row['output'])}
        html = """<p>Given <code>s</code>.</p><p><strong>Example 1:</strong></p><pre>Input: s = "a**"
Output: 2
Explanation: Underlined: <u>a**</u>.</pre><p><strong>Example 2:</strong></p><pre>Input: s = "b"
Output: 0</pre><p><strong>Constraints:</strong></p><p>None.</p>"""
        result = format_question(content, html, parse)['problem']
        self.assertEqual(result['examples'][0]['args'], ['a**'])
        self.assertEqual(result['examples'][1]['args'], ['b'])
        self.assertIn('bolded', result['examples'][0]['explanation'].lower())
        self.assertIn(r'**a\*\***', result['examples'][0]['explanation'])

    def test_changed_existing_example_is_rejected(self):
        content = {'problem': {'statementMarkdown': 'old', 'signature': {'parameters': []}, 'examples': [{'args': [1], 'expected': 9}]}}
        html = '<p>Intro.</p><p><strong>Example 1:</strong></p><pre>Input: x = 1\nOutput: 2</pre><p><strong>Constraints:</strong></p><ul><li>None.</li></ul>'
        with self.assertRaises(ValueError):
            format_question(content, html, lambda row, params: {'args': [1], 'expected': 2})

    def test_changed_input_uses_current_source(self):
        content = {'problem': {'statementMarkdown': 'old', 'signature': {'parameters': []}, 'examples': [{'args': [1], 'expected': 6, 'explanation': 'Old explanation'}]}}
        html = '<p>Intro.</p><p><strong>Example 1:</strong></p><pre>Input: x = 2\nOutput: 7</pre><p><strong>Constraints:</strong></p><ul><li>None.</li></ul>'
        result = format_question(content, html, lambda row, params: {'args': [2], 'expected': 7})
        self.assertEqual(result['problem']['examples'], [{'args': [2], 'expected': 7}])

    def test_nested_example_and_bold_image_wrappers(self):
        content = {'problem': {'statementMarkdown': 'old', 'signature': {'parameters': []}, 'examples': [{'args': [1], 'expected': 2}, {'args': [3], 'expected': 4}]}}
        html = '<p>Intro.</p><p><strong>Example 1:</strong></p><div class="example-block"><p><strong><img src="/img.png"></strong>​</p><p><strong>Input:</strong> 1</p><p><strong>Output:</strong> 2</p><p><strong>Example 2:</strong></p><div class="example-block"><p><strong>Input:</strong> 3</p><p><strong>Output:</strong> 4</p></div></div><p><strong>Constraints:</strong></p><ul><li>None.</li></ul>'
        def parse(row, params):
            return {'args': [int(row['input'])], 'expected': int(row['output'])}
        result = format_question(content, html, parse)['problem']
        self.assertEqual(len(result['examples']), 2)
        self.assertIn('/img.png', result['examples'][0]['explanation'])
        self.assertNotIn('Example 2', result['statementMarkdown'])


if __name__ == '__main__':
    unittest.main()
