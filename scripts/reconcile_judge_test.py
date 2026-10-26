"""Local API fixtures; never use an account token or contact Cloudflare."""
import importlib.util
import io
import json
from pathlib import Path
import unittest
import urllib.error

spec = importlib.util.spec_from_file_location("judge_reconcile", Path(__file__).with_name("reconcile-judge.py"))
judge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(judge)


class ReconcileJudgeTests(unittest.TestCase):
    def test_only_safe_notification_is_durably_published(self):
        calls = []
        def send(request, timeout):
            calls.append(request)
            self.assertEqual(timeout, 15)
            self.assertEqual(request.get_method(), "POST")
            self.assertEqual(request.full_url, "https://api.cloudflare.com/client/v4/accounts/" + "a"*32 + "/queues/" + "b"*32 + "/messages")
            self.assertEqual(json.loads(request.data), {"content_type": "json", "body": {"jobId": "deployment-reconcile"}})
            return io.BytesIO(b'{"success":true,"result":{}}')
        judge.publish("a"*32, "b"*32, "fixture-token", opener=send)
        self.assertEqual(len(calls), 1)

    def test_transport_failure_retries_same_safe_wake(self):
        requests, delays = [], []
        def send(request, timeout):
            requests.append(request.data)
            if len(requests) == 1:
                raise urllib.error.URLError("fixture connection reset")
            return io.BytesIO(b'{"success":true}')
        judge.publish("a"*32, "b"*32, "fixture-token", opener=send, sleep=delays.append)
        self.assertEqual(len(requests), 2)
        self.assertEqual(requests[0], requests[1])
        self.assertEqual(delays, [1])

    def test_auth_rejection_does_not_retry_or_disclose_token(self):
        calls = []
        def send(request, timeout):
            calls.append(request)
            raise urllib.error.HTTPError(request.full_url, 403, "fixture secret detail", {}, None)
        with self.assertRaisesRegex(RuntimeError, "HTTP 403") as error:
            judge.publish("a"*32, "b"*32, "fixture-token", opener=send)
        self.assertEqual(len(calls), 1)
        self.assertNotIn("fixture-token", str(error.exception))
        self.assertNotIn("fixture secret detail", str(error.exception))

    def test_redirects_and_unsuccessful_responses_fail_closed(self):
        for status in [302, 307]:
            def send(request, timeout):
                raise urllib.error.HTTPError(request.full_url, status, "fixture redirect", {}, None)
            with self.assertRaisesRegex(RuntimeError, "HTTP " + str(status)):
                judge.publish("a"*32, "b"*32, "fixture-token", opener=send)
        for body in [b'{"success":false}', b'invalid', b'[]', b'null', b'x'*65537]:
            with self.assertRaises(RuntimeError):
                judge.publish("a"*32, "b"*32, "fixture-token", opener=lambda request, timeout: io.BytesIO(body))

    def test_invalid_resource_identifiers_never_make_a_request(self):
        with self.assertRaises(RuntimeError):
            judge.publish("../outside", "b"*32, "fixture-token", opener=lambda *_args, **_kwargs: self.fail("unsafe request"))


if __name__ == "__main__":
    unittest.main()
