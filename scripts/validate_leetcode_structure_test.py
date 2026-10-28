import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class StructureValidationTest(unittest.TestCase):
    def test_rejects_unknown_fields_and_trailing_values(self):
        root = Path(__file__).resolve().parent.parent
        fixture = json.loads((root / 'packages/contracts/questions/example-v1.json').read_text())
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / 'valid.json').write_text(json.dumps(fixture))
            fixture['problem']['starterSource'] = 'obsolete'
            (path / 'unknown.json').write_text(json.dumps(fixture))
            (path / 'trailing.json').write_text('{} {}')
            result = subprocess.run(
                [sys.executable, str(root / 'scripts/validate-leetcode-structure.py'), directory],
                check=True, capture_output=True, text=True,
            )
        rows = {row['id']: row['error'] for row in map(json.loads, result.stdout.splitlines())}
        self.assertEqual(rows['valid'], '')
        self.assertIn('unknown field', rows['unknown'])
        self.assertIn('trailing', rows['trailing'])


if __name__ == '__main__':
    unittest.main()
