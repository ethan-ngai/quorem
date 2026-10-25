"""Patch only the admission runner onto a source-verified, previously published image."""
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys

base_sha = sys.argv[1]
if len(base_sha) != 40 or any(char not in "0123456789abcdef" for char in base_sha):
    raise SystemExit("Invalid verified image revision")
directory = Path(".local/deploy/runner-patch")
directory.mkdir(parents=True, exist_ok=True)
environment = {**os.environ, "CGO_ENABLED": "0", "GOOS": "linux", "GOARCH": "amd64"}
subprocess.run(["go", "build", "-o", str(directory / "runner"), "./apps/runner/cmd/runner"],
               env=environment, check=True)
credential = json.loads(subprocess.check_output([
    "vp", "-C", "apps/realtime-cloudflare", "exec", "wrangler", "containers", "registries",
    "credentials", "registry.cloudflare.com", "--pull", "--json", "--expiration-minutes", "15",
], text=True))
password = credential["password"]
print("::add-mask::" + password, flush=True)
subprocess.run(["docker", "login", "registry.cloudflare.com", "--username", credential["username"],
                "--password-stdin"], input=password, text=True, check=True)
base = f"registry.cloudflare.com/{os.environ['CLOUDFLARE_ACCOUNT_ID']}/quorem-production:{base_sha}"
subprocess.run(["docker", "pull", "--platform", "linux/amd64", base], check=True)
digest = json.loads(subprocess.check_output(["docker", "image", "inspect", base], text=True))[0]["RepoDigests"][0]
if not digest.startswith(base.rsplit(":", 1)[0] + "@sha256:"):
    raise SystemExit("Unexpected verified image digest")
shutil.copyfile("deploy/start.py", directory / "start.py")
(directory / "Dockerfile").write_text("ARG BASE_IMAGE\nFROM ${BASE_IMAGE}\nCOPY runner /app/bin/runner\nCOPY start.py /app/deploy/start.py\n")
subprocess.run(["docker", "build", "--platform", "linux/amd64", "--build-arg", "BASE_IMAGE=" + digest,
                "-t", "quorem-production:" + os.environ["GITHUB_SHA"], str(directory)], check=True)
