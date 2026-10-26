import contextlib
import importlib.util
import io
import json
import pathlib
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('verify_auth', pathlib.Path(__file__).with_name('verify-production-auth.py'))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class Response(io.BytesIO):
    def __init__(self, status, payload):
        super().__init__(json.dumps(payload).encode())
        self.status = status


class AuthenticationProbeTests(unittest.TestCase):
    def run_probe(self, api_status=200, revoked_status=401):
        calls = []
        output = io.StringIO()

        class Opener:
            def open(self, request, timeout):
                self_test.assertEqual(request.get_header("User-agent"), "Quorem-Deployment-Probe/1.0")
                calls.append(request)
                route = request.full_url.removeprefix('https://quorem.test')
                if route == '/api/auth/token':
                    return Response(200, {'token': 'private-bearer'})
                if route == '/v1/session':
                    self_test.assertEqual(request.get_header('Authorization'), 'Bearer private-bearer')
                    signed_out = any(item.full_url.endswith('/sign-out') for item in calls)
                    return Response(revoked_status if signed_out else api_status, {'user': {'id': 'fixture'}})
                return Response(200, {})

        self_test = self
        try:
            with patch.object(probe.urllib.request, 'build_opener', return_value=Opener()), contextlib.redirect_stdout(output):
                probe.verify('https://quorem.test', 'fixture-user', 'private-password')
        finally:
            self.assertNotIn('private-password', output.getvalue())
            self.assertNotIn('private-bearer', output.getvalue())
            self.assertEqual(sum(item.full_url.endswith('/sign-out') for item in calls), 1)
        return calls

    def test_success_verifies_revocation_without_printing_credentials(self):
        calls = self.run_probe()
        login = next(item for item in calls if item.full_url.endswith('/sign-in/username'))
        self.assertEqual(json.loads(login.data)['password'], 'private-password')

    def test_api_failure_still_closes_the_probe_session(self):
        with self.assertRaisesRegex(RuntimeError, 'HTTP 503'):
            self.run_probe(api_status=503)

    def test_revoked_session_cannot_remain_authorized(self):
        with self.assertRaisesRegex(RuntimeError, 'HTTP 200'):
            self.run_probe(revoked_status=200)

    def test_rejects_insecure_or_nonorigin_destinations(self):
        for origin in ['http://quorem.test', 'https://quorem.test/path', 'https://quorem.test?query=1']:
            with self.assertRaisesRegex(RuntimeError, 'exact HTTPS'):
                probe.verify(origin, 'user', 'password')


if __name__ == '__main__':
    unittest.main()
