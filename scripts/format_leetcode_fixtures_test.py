import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class RefreshTest(unittest.TestCase):
    def test_refresh_preserves_unmatched_and_checks_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fixtures, cache, output = root / 'in', root / 'cache', root / 'out'
            fixtures.mkdir()
            cache.mkdir()
            content = {'problem': {'leetcodeId': 7, 'slug': 'lc-test', 'statementMarkdown': 'Original', 'signature': {'parameters': [{'name': 'x', 'type': 'int'}]}, 'examples': [{'args': [1], 'expected': 2}]}}
            raw = json.dumps(content).encode()
            (fixtures / '7.json').write_bytes(raw)
            manifest = {'corpus': 'source', 'fixtures': [{'file': '7.json', 'leetcodeId': 7, 'sha256': hashlib.sha256(raw).hexdigest()}]}
            (fixtures / 'manifest.json').write_text(json.dumps(manifest))
            html = '<p>Given <code>x</code>.</p><p><strong>Example 1:</strong></p><pre>Input: x = 1\nOutput: 2\nExplanation: 1 + 1.</pre><p><strong>Constraints:</strong></p><p>None.</p>'
            (cache / '7.json').write_text(json.dumps({'question': {'questionFrontendId': '7', 'titleSlug': 'test', 'content': html}}))
            command = [sys.executable, str(Path(__file__).with_name('format-leetcode-fixtures.py')), str(fixtures), str(cache), str(output)]
            subprocess.run(command, check=True, capture_output=True)
            result = json.loads((output / 'candidates' / '7.json').read_text())
            self.assertIn('`x`', result['problem']['statementMarkdown'])
            self.assertEqual(result['problem']['examples'][0]['explanation'], '1 + 1.')
            (fixtures / '7.json').write_text('{}')
            command[-1] = str(root / 'bad')
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)


if __name__ == '__main__':
    unittest.main()
