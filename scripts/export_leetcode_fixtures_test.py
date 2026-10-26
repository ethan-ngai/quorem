import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('export_fixtures', Path(__file__).with_name('export-leetcode-fixtures.py'))
export = importlib.util.module_from_spec(spec)
spec.loader.exec_module(export)


class ExportTest(unittest.TestCase):
    def test_exports_only_matching_successes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            candidates = root / 'candidates'
            candidates.mkdir()
            data = json.dumps({'problem': {'examples': [{'args': [1], 'expected': 1}]}, 'hiddenCases': [{'args': [2], 'expected': 2}]}).encode()
            (root / 'report.json').write_text(json.dumps({'corpus': 'source'}))
            (root / 'stage-report.json').write_text(json.dumps({'sources': {}}))
            (candidates / '1.json').write_bytes(data)
            (candidates / '2.json').write_bytes(data)
            digest = hashlib.sha256(data).hexdigest()
            (root / 'structure').write_text('\n'.join(json.dumps({'id': i, 'sha256': digest, 'error': ''}) for i in ('1', '2')))
            (root / 'harness').write_text('\n'.join(json.dumps({'id': i, 'sha256': digest if i == '1' else 'stale', 'status': 'passed', 'cases': 2}) for i in ('1', '2')))
            with patch.object(sys, 'argv', ['export', str(candidates), str(root / 'structure'), str(root / 'harness'), str(root / 'output'), '--stage-report', str(root / 'stage-report.json')]):
                export.main()
            self.assertTrue((root / 'output' / '1.json').exists())
            self.assertFalse((root / 'output' / '2.json').exists())


if __name__ == '__main__':
    unittest.main()
