import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("upload_worker_version", Path(__file__).with_name("upload-worker-version.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Response(io.BytesIO):
    headers = {}
    def __enter__(self):
        return self
    def __exit__(self, *args):
        self.close()


class UploadTest(unittest.TestCase):
    def test_upload_preserves_named_image_metadata_and_module(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "worker.js"
            path.write_text("export default {};", encoding="utf-8")
            seen = []
            def open_request(request, timeout):
                seen.append(request)
                return Response(json.dumps({"success": True, "result": {"id": "12345678-1234-1234-1234-123456789012"}}).encode())
            metadata = {"containers": [{"class_name": "Case", "name": "case", "images": {"python": "example@sha256:123"}}]}
            version = module.upload("a" * 32, "quorem", "secret", metadata, [{"name": "worker.js", "path": str(path)}], open_request)
            self.assertEqual(version, "12345678-1234-1234-1234-123456789012")
            self.assertIn(b'"images":{"python":"example@sha256:123"}', seen[0].data)
            self.assertIn(b'export default {};', seen[0].data)
            self.assertIn(b'name="worker.js"; filename="worker.js"', seen[0].data)
            self.assertEqual(len(seen), 1)

    def test_rejects_invalid_parts_and_responses(self):
        with self.assertRaises(ValueError):
            module.multipart({}, [{"name": '../bad', "path": '/dev/null'}], 'safe')
        with self.assertRaises(RuntimeError):
            module.upload('a' * 32, 'quorem', 'secret', {}, [], lambda *a, **k: Response(b'{"success":false}'))

    def test_image_preparation_waits_for_ready_and_rejects_unpinned_images(self):
        responses = iter(["pending", "ready"])
        calls = []
        def open_request(request, timeout):
            calls.append(json.loads(request.data))
            return Response(json.dumps({"success": True, "result": {"status": next(responses)}}).encode())
        image = f"registry.cloudflare.com/{'a' * 32}/judge@sha256:{'b' * 64}"
        module.prepare_image('a' * 32, 'secret', image, open_request, sleep=lambda _: None)
        self.assertEqual(calls, [{"image": image}, {"image": image}])
        with self.assertRaises(ValueError):
            module.prepare_image('a' * 32, 'secret', 'registry.cloudflare.com/a/judge:latest')

    def test_deploy_requires_exact_version(self):
        version = '12345678-1234-1234-1234-123456789012'
        def open_request(request, timeout):
            if request.get_method() == 'POST':
                payload = json.loads(request.data)
                self.assertEqual(payload, {"strategy": "percentage", "versions": [{"version_id": version, "percentage": 100}]})
                return Response(b'{}')
            return Response(json.dumps({"success": True, "result": {"deployments": [{"versions": [{"version_id": version, "percentage": 100}]}]}}).encode())
        module.deploy('a' * 32, 'quorem', 'secret', version, open_request)
        with self.assertRaises(RuntimeError):
            module.deploy('a' * 32, 'quorem', 'secret', version, lambda *a, **k: Response(b'{"success":true,"result":{"deployments":[]}}'))

    def test_image_preparation_times_out_after_fifteen_minutes(self):
        image = f"registry.cloudflare.com/{'a' * 32}/judge@sha256:{'b' * 64}"
        times = iter([0, 0, 901])
        pending = lambda *a, **k: Response(b'{"success":true,"result":{"status":"pending"}}')
        with self.assertRaisesRegex(RuntimeError, 'timed out'):
            module.prepare_image('a' * 32, 'secret', image, pending, sleep=lambda _: None, clock=lambda: next(times))

    def test_resolve_image_uses_short_lived_credentials_and_manifest_digest(self):
        requests = []
        def open_request(request, timeout):
            requests.append(request)
            if len(requests) == 1:
                return Response(b'{"success":true,"result":{"password":"token"}}')
            result = Response(b'')
            result.headers = {"Docker-Content-Digest": "sha256:" + "b" * 64}
            return result
        image = module.resolve_image('a' * 32, 'api-token', 'quorem-judge', 'revision', open_request)
        self.assertEqual(image, f"registry.cloudflare.com/{'a' * 32}/quorem-judge@sha256:{'b' * 64}")
        self.assertEqual(requests[1].method, 'HEAD')
        self.assertNotIn('api-token', requests[1].get_header('Authorization'))


if __name__ == '__main__':
    unittest.main()
