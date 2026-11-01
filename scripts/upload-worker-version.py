"""Upload a Worker version with complete container image metadata."""
import json
import base64
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import re
import secrets
import sys
import time
from urllib.parse import quote
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        return None


def resolve_image(account, token, repository, tag, opener=None):
    if not re.fullmatch(r"[a-fA-F0-9]{32}", account) or not re.fullmatch(r"[a-z0-9][a-z0-9._/-]*", repository) or not re.fullmatch(r"[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}", tag):
        raise ValueError("Invalid image reference")
    if opener is None:
        opener = build_opener(NoRedirect()).open
    request = Request(
        f"https://api.cloudflare.com/client/v4/accounts/{account}/containers/registries/registry.cloudflare.com/credentials",
        method="POST", data=b'{"expiration_minutes":5,"permissions":["pull"]}',
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
    )
    with opener(request, timeout=30) as response:
        data = response.read(65537)
    if len(data) > 65536:
        raise RuntimeError("Registry credential response exceeded its bound")
    try:
        payload = json.loads(data)
        password = payload["result"]["password"]
    except (ValueError, KeyError, TypeError):
        raise RuntimeError("Registry credential response was invalid") from None
    if payload.get("success") is not True or not isinstance(password, str) or not password:
        raise RuntimeError("Registry credentials unavailable")
    authorization = base64.b64encode(("v1:" + password).encode()).decode()
    head = Request(
        f"https://registry.cloudflare.com/v2/{account}/{repository}/manifests/{tag}",
        method="HEAD", headers={"Authorization": "Basic " + authorization, "Accept": "application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json"},
    )
    with opener(head, timeout=30) as response:
        digest = response.headers.get("Docker-Content-Digest", "")
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
        raise RuntimeError("Registry image digest unavailable")
    return f"registry.cloudflare.com/{account}/{repository}@{digest}"


def prepare_image(account, token, image, opener=None, sleep=time.sleep, clock=time.monotonic):
    prefix = f"registry.cloudflare.com/{account}/"
    if not image.startswith(prefix) or not re.fullmatch(r"[a-zA-Z0-9._/-]+@sha256:[a-f0-9]{64}", image):
        raise ValueError("Expected a digest-pinned account image")
    if opener is None:
        opener = build_opener(NoRedirect()).open
    request = Request(
        f"https://api.cloudflare.com/client/v4/accounts/{account}/containers/image-preparations",
        method="POST", data=json.dumps({"image": image}).encode(),
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
    )
    deadline = clock() + 900
    failures = 0
    while clock() < deadline:
        # Cloudflare defines preparation as idempotent; repeating observes its state.
        try:
            with opener(request, timeout=30) as response:
                raw = response.read(1048577)
        except HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or failures >= 5:
                raise
            error.close()
            failures += 1
            sleep(min(2 ** failures, 10))
            continue
        failures = 0
        if len(raw) > 1048576:
            raise RuntimeError("Image preparation response exceeded its bound")
        try:
            payload = json.loads(raw)
            status = payload["result"]["status"]
        except (ValueError, KeyError, TypeError):
            raise RuntimeError("Image preparation response was invalid") from None
        if payload.get("success") is not True or status not in ("pending", "ready", "error"):
            raise RuntimeError("Image preparation was rejected")
        if status == "ready":
            return
        if status == "error":
            raise RuntimeError("Image preparation failed")
        sleep(2)
    raise RuntimeError("Image preparation timed out")


def multipart(metadata, modules, boundary):
    if not re.fullmatch(r"[a-zA-Z0-9-]+", boundary):
        raise ValueError("Invalid multipart boundary")
    result = bytearray()

    def part(name, content_type, value, filename=False):
        if not isinstance(name, str) or any(not re.fullmatch(r"[a-zA-Z0-9_][a-zA-Z0-9._-]*", segment) for segment in name.split("/")):
            raise ValueError("Invalid multipart part name")
        disposition = f'form-data; name="{name}"'
        if filename:
            disposition += f'; filename="{name}"'
        result.extend(f'--{boundary}\r\nContent-Disposition: {disposition}\r\nContent-Type: {content_type}\r\n\r\n'.encode())
        result.extend(value)
        result.extend(b"\r\n")

    part("metadata", "application/json", json.dumps(metadata, separators=(",", ":")).encode())
    names = {"metadata"}
    for module in modules:
        if set(module) != {"name", "path"} or not isinstance(module["name"], str) or module["name"] in names:
            raise ValueError("Invalid module configuration")
        names.add(module["name"])
        part(module["name"], "application/javascript+module", Path(module["path"]).read_bytes(), filename=True)
    result.extend(f"--{boundary}--\r\n".encode())
    return bytes(result)


def upload(account, worker, token, metadata, modules, opener=None):
    if not re.fullmatch(r"[a-fA-F0-9]{32}", account) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,63}", worker) or not token:
        raise ValueError("Invalid Worker upload configuration")
    if opener is None:
        opener = build_opener(NoRedirect()).open
    boundary = "quorem-" + secrets.token_hex(24)
    body = multipart(metadata, modules, boundary)
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/workers/scripts/{quote(worker, safe='')}/versions"
    request = Request(url, method="POST", data=body, headers={
        "Authorization": "Bearer " + token,
        "Content-Type": "multipart/form-data; boundary=" + boundary,
    })
    # A lost upload response is ambiguous. Never replay a version mutation automatically.
    with opener(request, timeout=60) as response:
        raw = response.read(1048577)
    if len(raw) > 1048576:
        raise RuntimeError("Worker upload response exceeded its bound")
    try:
        payload = json.loads(raw)
        version = payload["result"]["id"]
    except (ValueError, KeyError, TypeError):
        raise RuntimeError("Worker upload response was invalid") from None
    if payload.get("success") is not True or not isinstance(version, str) or not re.fullmatch(r"[0-9a-fA-F-]{36}", version):
        raise RuntimeError("Worker upload was rejected")
    return version


def deploy(account, worker, token, version, opener=None):
    if not re.fullmatch(r"[a-fA-F0-9]{32}", account) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,63}", worker) or not re.fullmatch(r"[0-9a-fA-F-]{36}", version) or not token:
        raise ValueError("Invalid Worker deployment configuration")
    if opener is None:
        opener = build_opener(NoRedirect()).open
    request = Request(
        f"https://api.cloudflare.com/client/v4/accounts/{account}/workers/scripts/{quote(worker, safe='')}/deployments",
        method="POST", data=json.dumps({"strategy": "percentage", "versions": [{"version_id": version, "percentage": 100}]}).encode(),
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
    )
    with opener(request, timeout=60) as response:
        result = response.read(1048577)
    if len(result) > 1048576:
        raise RuntimeError("Worker deployment response exceeded its bound")
    try:
        payload = json.loads(result)
    except ValueError:
        payload = None
    if isinstance(payload, dict) and payload.get("success") is False:
        raise RuntimeError("Worker deployment was not confirmed")
    # Confirm the active deployment through the read API, including when the
    # mutation response does not include the documented deployment object.
    request = Request(request.full_url, headers={"Authorization": "Bearer " + token})
    with opener(request, timeout=60) as response:
        raw = response.read(1048577)
    if len(raw) > 1048576:
        raise RuntimeError("Worker deployment response exceeded its bound")
    try:
        payload = json.loads(raw)
        versions = payload["result"]["deployments"][0]["versions"]
    except (ValueError, KeyError, TypeError, IndexError):
        raise RuntimeError("Worker deployment response was invalid") from None
    if payload.get("success") is not True or not isinstance(versions, list) or len(versions) != 1 or versions[0].get("version_id") != version or versions[0].get("percentage") != 100:
        raise RuntimeError("Worker deployment was not confirmed")


def main():
    stage = "configuration"
    try:
        config = json.loads(os.environ["QUOREM_WORKER_UPLOAD"]) if "QUOREM_WORKER_UPLOAD" in os.environ else json.load(sys.stdin)
        account = os.environ["CLOUDFLARE_ACCOUNT_ID"]
        token = os.environ["CLOUDFLARE_API_TOKEN"]
        prefix = f"registry.cloudflare.com/{account}/"
        for container in config["metadata"].get("containers", []):
            for name, reference in container.get("images", {}).items():
                if not reference.startswith(prefix):
                    raise ValueError("Invalid registry image")
                if "@sha256:" not in reference:
                    repository, tag = reference[len(prefix):].rsplit(":", 1)
                    stage = "image digest resolution"
                    container["images"][name] = resolve_image(account, token, repository, tag)
        images = {image for container in config["metadata"].get("containers", []) for image in container.get("images", {}).values()}
        stage = "image preparation"
        with ThreadPoolExecutor(max_workers=max(1, len(images))) as executor:
            list(executor.map(lambda image: prepare_image(account, token, image), sorted(images)))
        stage = "Worker version upload"
        version = upload(account, config["worker"], token, config["metadata"], config["modules"])
        if config.get("deploy", False):
            stage = "Worker deployment"
            deploy(account, config["worker"], token, version)
    except HTTPError as error:
        try:
            errors = json.loads(error.read(65537)).get("errors", [])
            codes = [str(item["code"]) for item in errors if isinstance(item, dict) and type(item.get("code")) is int]
        except (ValueError, TypeError, AttributeError):
            codes = []
        suffix = f"; Cloudflare codes {', '.join(codes[:10])}" if codes else ""
        raise SystemExit(f"{stage} failed (HTTP {error.code}{suffix})") from None
    except RuntimeError as error:
        # Only report fixed local messages; API responses may include secrets.
        safe_errors = {
            "Registry credential response exceeded its bound", "Registry credential response was invalid",
            "Registry credentials unavailable", "Registry image digest unavailable",
            "Image preparation response exceeded its bound", "Image preparation response was invalid",
            "Image preparation was rejected", "Image preparation failed", "Image preparation timed out",
            "Worker upload response exceeded its bound", "Worker upload response was invalid",
            "Worker upload was rejected", "Worker deployment response exceeded its bound",
            "Worker deployment response was invalid", "Worker deployment was not confirmed",
        }
        detail = str(error) if str(error) in safe_errors else "unexpected error"
        raise SystemExit(f"{stage} failed: {detail}") from None
    except Exception as error:
        # Provider errors can contain upload metadata, including secret bindings.
        raise SystemExit(f"{stage} failed ({type(error).__name__})") from None
    print(json.dumps({"version_id": version}))


if __name__ == "__main__":
    main()
