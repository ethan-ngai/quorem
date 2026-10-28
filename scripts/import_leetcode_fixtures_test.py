import hashlib
import json
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SCRIPT = Path(__file__).with_name('import-leetcode-fixtures.py')


class Handler(BaseHTTPRequestHandler):
    draft = None
    creates = 0
    publishes = 0
    fail_after_create = False
    fail_after_publish = False
    published = None

    def log_message(self, *args):
        pass

    def send_json(self, status, value):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(value).encode())

    def do_GET(self):
        if self.path == '/v1/problems/lc-example':
            if self.published:
                return self.send_json(200, self.published)
            return self.send_json(404, {})
        if self.path == '/v1/admin/question-drafts':
            items = [] if not self.draft else [{'id': self.draft['id'], 'slug': 'lc-example'}]
            return self.send_json(200, {'items': items})
        if self.path == '/v1/admin/question-drafts/one' and self.draft:
            return self.send_json(200, self.draft)
        self.send_json(404, {})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if self.path == '/v1/admin/question-drafts':
            type(self).creates += 1
            type(self).draft = {'id': 'one', 'revision': '1', 'content': body['content']}
            if self.fail_after_create:
                type(self).fail_after_create = False
                return self.send_json(500, {})
            return self.send_json(201, self.draft)
        if self.path == '/v1/admin/question-drafts/one/publish':
            type(self).publishes += 1
            type(self).draft['publishedVersionId'] = 'version'
            if self.draft['content']['implementations']:
                self.draft['content']['implementations'][0]['starterSource'] = 'generated'
            type(self).published = {'id': 'version', 'leetcodeId': 1}
            if self.fail_after_publish:
                type(self).fail_after_publish = False
                return self.send_json(500, {})
            return self.send_json(200, self.draft)
        self.send_json(404, {})


class ImportTest(unittest.TestCase):
    def setUp(self):
        Handler.draft = None
        Handler.creates = Handler.publishes = 0
        Handler.fail_after_create = False
        Handler.fail_after_publish = False
        Handler.published = None
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.tmp = tempfile.TemporaryDirectory()
        self.directory = Path(self.tmp.name)
        self.content = {'problem': {'slug': 'lc-example', 'leetcodeId': 1, 'statementMarkdown': 'x', 'signature': {}}, 'hiddenCases': [], 'implementations': [{'language': 'python', 'starterSource': 'authored'}]}
        data = json.dumps(self.content).encode()
        (self.directory / '1.json').write_bytes(data)
        (self.directory / 'manifest.json').write_text(json.dumps({'fixture_count': 1, 'fixtures': [{'file': '1.json', 'sha256': hashlib.sha256(data).hexdigest(), 'leetcodeId': 1}]}))

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def run_import(self, *args):
        return subprocess.run([sys.executable, str(SCRIPT), str(self.directory), '--target', f'http://127.0.0.1:{self.server.server_port}', '--dev-user', 'alice', *args], capture_output=True, text=True)

    def test_dry_run_create_resume_and_publish(self):
        self.assertEqual(self.run_import().returncode, 0)
        self.assertEqual(Handler.creates, 0)
        self.assertEqual(self.run_import('--apply').returncode, 0)
        self.assertEqual(self.run_import('--apply').returncode, 0)
        self.assertEqual(Handler.creates, 1)
        self.assertEqual(self.run_import('--apply', '--publish', 'private').returncode, 0)
        self.assertEqual(self.run_import('--apply', '--publish', 'private').returncode, 0)
        self.assertEqual(Handler.publishes, 1)

    def test_reconcile_unknown_create_outcome(self):
        Handler.fail_after_create = True
        self.assertNotEqual(self.run_import('--apply').returncode, 0)
        self.assertEqual(self.run_import('--apply').returncode, 0)
        self.assertEqual(Handler.creates, 1)

    def test_hash_mismatch_prevents_writes(self):
        (self.directory / '1.json').write_text('{}')
        self.assertNotEqual(self.run_import('--apply').returncode, 0)
        self.assertEqual(Handler.creates, 0)

    def test_existing_publication_requires_import_evidence(self):
        Handler.published = {'id': 'other-version', 'leetcodeId': 1}
        result = self.run_import('--apply', '--publish', 'global')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(Handler.creates, 0)
        self.assertEqual(Handler.publishes, 0)

    def test_reconcile_unknown_publish_outcome(self):
        Handler.fail_after_publish = True
        self.assertNotEqual(self.run_import('--apply', '--publish', 'global').returncode, 0)
        self.assertEqual(self.run_import('--apply', '--publish', 'global').returncode, 0)
        self.assertEqual(Handler.publishes, 1)

    def test_existing_draft_with_different_solutions_is_not_published(self):
        self.assertEqual(self.run_import('--apply').returncode, 0)
        Handler.draft['content']['solutions'] = [{'language': 'python', 'source': 'different'}]
        result = self.run_import('--apply', '--publish', 'global')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(Handler.publishes, 0)

    def test_non_loopback_target_rejected(self):
        result = subprocess.run([sys.executable, str(SCRIPT), str(self.directory), '--target', 'https://quorem.app', '--dev-user', 'alice', '--apply'], capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(Handler.creates, 0)


if __name__ == '__main__':
    unittest.main()
