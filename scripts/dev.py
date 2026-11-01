"""Run local services; terminate every child when one exits."""

import os
import json
import secrets
from pathlib import Path
import signal
import subprocess
import time
from urllib.parse import urlparse
from garage import prepare_garage

ROOT = Path(__file__).resolve().parent.parent
os.chdir(ROOT)
ENV = os.environ.copy()
ENV.setdefault("QUOREM_ENV", "development")
ENV.setdefault("APP_ENV", "local")
ENV.setdefault("QUOREM_DEV_IDENTITY", "false")
ENV.setdefault("DATABASE_URL", "postgres://quorem:quorem@localhost:54329/quorem_hono_dev?sslmode=disable")
ENV.setdefault("API_ADDR", "127.0.0.1:8080")
ENV.setdefault("LANGUAGE_ADDR", "127.0.0.1:8081")
ENV.setdefault("WEB_ORIGIN", "http://localhost:5173")
ENV.setdefault("QUOREM_MARKETING_BASE", "/_marketing")
ENV.setdefault("QUOREM_MARKETING_DEV_ORIGIN", "http://127.0.0.1:4321")
ENV.setdefault("LANGUAGE_URL", "http://127.0.0.1:8081")
ENV.setdefault("AUTH_MODE", "password")
ENV.setdefault("AUTH_ORIGIN", ENV["WEB_ORIGIN"])
ENV.setdefault("AUTH_DATABASE_URL", ENV["DATABASE_URL"])
ENV.setdefault("API_IDENTITY_URL", f"http://{ENV['API_ADDR']}")
ENV.setdefault("VITE_LANGUAGE_URL", f"ws://{ENV['LANGUAGE_ADDR']}/lsp")
ENV.setdefault("QUOREM_API_DEV_ORIGIN", f"http://{ENV['API_ADDR']}")
ENV.setdefault("QUOREM_AUTH_DEV_ORIGIN", f"http://{ENV['API_ADDR']}")
if ENV["QUOREM_ENV"] != "development" or ENV["APP_ENV"] != "local":
    raise SystemExit("make dev requires QUOREM_ENV=development and APP_ENV=local")

# Persist generated credentials across restarts, outside source control.
credential_file = ROOT / ".local/auth-preview.json"
credential_file.parent.mkdir(parents=True, exist_ok=True)
if not credential_file.exists():
    values = {key: secrets.token_urlsafe(32) for key in (
        "BETTER_AUTH_SECRET", "AUTH_INTERNAL_SECRET", "AUTH_SEED_PASSWORD"
    )}
    descriptor = os.open(credential_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        json.dump(values, stream, indent=2)
values = json.loads(credential_file.read_text())
changed = False
for key in ("AUTH_MAIL_INTENT_KEY", "MATCH_INVITE_KEY", "QUOREM_RUNNER_COMMAND_SECRET",
            "QUOREM_RUNNER_DRAIN_SECRET", "QUOREM_VERIFICATION_SOURCE_KEY",
            "QUOREM_VERIFICATION_SERVICE_KEY"):
    if key not in values:
        values[key] = secrets.token_hex(32)
        changed = True
if changed:
    credential_file.write_text(json.dumps(values, indent=2))
    credential_file.chmod(0o600)
for key, value in values.items():
    ENV.setdefault(key, value)

local_mail = ENV["QUOREM_DEV_IDENTITY"] != "true" and ENV["AUTH_MODE"] == "password"
if local_mail:
    ENV.setdefault("SMTP_HOST", "127.0.0.1")
    ENV.setdefault("SMTP_PORT", "51025")
    ENV.setdefault("SMTP_FROM", "Quorem <accounts@quorem.local>")
hosted_intelligence = ENV.get("QUOREM_HOSTED_INTELLIGENCE") == "true"
ENV.setdefault("VITE_HOSTED_INTELLIGENCE", "true" if hosted_intelligence else "false")
language_builds = []
language_services = []
if hosted_intelligence:
    language_builds = [
        ["docker", "build", "-f", "apps/language/Dockerfile", "-t", "quorem-language:local", "."],
    ]
    language_services = [["vp", "-C", "apps/language", "run", "dev"]]
processes = []
local_storage = prepare_garage(ROOT, ENV) if ENV["QUOREM_DEV_IDENTITY"] != "true" else False


def stop(_signal, _frame):
    raise KeyboardInterrupt


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    Path(".local/bin").mkdir(parents=True, exist_ok=True)
    for command in [
        ["docker", "compose", *(["--profile", "storage"] if local_storage else []), *(["--profile", "mailer"] if local_mail else []), "up", "-d", "--wait"],
        ["docker", "build", "-f", "apps/runner/Dockerfile", "-t", "quorem-python:local", "."],
        *[["docker", "build", "-f", f"apps/runner/Dockerfile.{language}", "-t", f"quorem-{language}:local", "."] for language in ("java", "typescript", "ocaml", "postgres")],
        *language_builds,
    ]:
        subprocess.run(command, check=True, env=ENV)
    private_dir = ROOT / ".local/native-runtime"
    private_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    private_dir.chmod(0o700)
    key_file = private_dir / "verifier.pem"
    if not key_file.exists():
        subprocess.run(["vp", "exec", "node", "--input-type=module", "-e", "import {generateKeyPairSync} from 'node:crypto'; import {writeFileSync} from 'node:fs'; writeFileSync(process.argv[1], generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'}), {mode:0o600,flag:'wx'})", str(key_file)], check=True, env=ENV)
    public_key = subprocess.check_output(["vp", "exec", "node", "--input-type=module", "-e", "import {createPrivateKey,createPublicKey} from 'node:crypto'; import {readFileSync} from 'node:fs'; console.log(createPublicKey(createPrivateKey(readFileSync(process.argv[1]))).export({type:'spki',format:'der'}).toString('base64'))", str(key_file)], env=ENV, text=True).strip()
    fence_root = private_dir / "fences"
    fence_root.mkdir(mode=0o700, exist_ok=True)
    ENV.setdefault("QUOREM_DOCKER_SOCKET", ENV.get("DOCKER_HOST", "unix:///var/run/docker.sock").removeprefix("unix://"))
    ENV.setdefault("QUOREM_DOCKER_FENCE_ROOT", str(fence_root.resolve()))
    ENV.setdefault("QUOREM_DOCKER_NAMESPACE", "quorem-local")
    scope = subprocess.check_output(["vp", "exec", "node", "--input-type=module", "-e", "import {dockerSandbox} from './apps/runner/src/sandbox/docker.ts'; console.log((await dockerSandbox({socket:process.env.QUOREM_DOCKER_SOCKET,stateRoot:process.env.QUOREM_DOCKER_FENCE_ROOT,namespace:process.env.QUOREM_DOCKER_NAMESPACE,cleanupMs:30000})).scope)"], env=ENV, text=True).strip()
    ENV.setdefault("HOST", urlparse(f"http://{ENV['API_ADDR']}").hostname or "127.0.0.1")
    ENV.setdefault("PORT", str(urlparse(f"http://{ENV['API_ADDR']}").port or 8080))
    ENV.setdefault("QUOREM_DATABASE_LISTEN_URL", ENV["DATABASE_URL"])
    ENV.setdefault("QUOREM_ALLOWED_ORIGINS", ENV["WEB_ORIGIN"])
    ENV.setdefault("IDENTITY_MODE", "local" if ENV["QUOREM_DEV_IDENTITY"] == "true" else "managed")
    ENV.setdefault("RUNNER_PEERS", json.dumps([{"secret": ENV["QUOREM_RUNNER_COMMAND_SECRET"], "scope": scope, "resumable": True}]))
    ENV.setdefault("VERIFICATION_SOURCE_CREDENTIAL", ENV["QUOREM_VERIFICATION_SOURCE_KEY"])
    ENV.setdefault("VERIFICATION_SERVICE_CREDENTIAL", ENV["QUOREM_VERIFICATION_SERVICE_KEY"])
    ENV.setdefault("VERIFICATION_PUBLIC_KEY", public_key)
    ENV.setdefault("VERIFICATION_ACCESS_MODE", "none")
    ENV.setdefault("VERIFICATION_SERVICE_ORIGIN", "http://127.0.0.1:18761")
    ENV.setdefault("QUOREM_VERIFICATION_SOURCE_ORIGIN", f"http://{ENV['API_ADDR']}")
    ENV.setdefault("QUOREM_VERIFICATION_SIGNING_KEY_FILE", str(key_file.resolve()))
    ENV.setdefault("QUOREM_VERIFIER_LISTEN", "127.0.0.1:18761")
    ENV.setdefault("QUOREM_SANDBOX_PROVIDER", "docker")
    ENV.setdefault("QUOREM_RUNNER_MODE", "continuous")
    ENV.setdefault("QUOREM_RUNNER_LISTEN", "127.0.0.1:18762")
    ENV.setdefault("QUOREM_RUNNER_COMMAND_ORIGIN", f"http://{ENV['API_ADDR']}")
    ENV.setdefault("EXECUTION_DRAIN_URL", "http://127.0.0.1:18762/internal/drain")
    ENV.setdefault("EXECUTION_DRAIN_SECRET", ENV["QUOREM_RUNNER_DRAIN_SECRET"])
    ENV.setdefault("EXECUTION_DRAIN_ACCESS_MODE", "none")
    ENV.setdefault("EXECUTION_WAKE_PROVIDER", "sqs")
    ENV.setdefault("SQS_LOCAL_ENDPOINT", "http://127.0.0.1:19324")
    queue_endpoint = urlparse(ENV["SQS_LOCAL_ENDPOINT"])
    if queue_endpoint.scheme != "http" or queue_endpoint.hostname not in ("127.0.0.1", "localhost") or queue_endpoint.path not in ("", "/") or queue_endpoint.query or queue_endpoint.fragment or queue_endpoint.username or queue_endpoint.password:
        raise SystemExit("SQS_LOCAL_ENDPOINT requires a loopback HTTP origin")
    queue_port = queue_endpoint.port or 80
    ENV.setdefault("SQS_QUEUE_URL", "https://sqs.us-east-1.amazonaws.com/000000000000/local")
    ENV.setdefault("AWS_REGION", "us-east-1")
    ENV.setdefault("AWS_ACCESS_KEY_ID", "local-fixture")
    ENV.setdefault("AWS_SECRET_ACCESS_KEY", "local-fixture")
    ENV.setdefault("GUEST_CREATION", "true")
    ENV.setdefault("GUEST_ADMISSION", "true")
    ENV.setdefault("GUEST_EXECUTION", "true")
    subprocess.run(["vp", "exec", "node", "apps/api/src/cli/seed-local.ts"], check=True, env=ENV)
    subprocess.run(["vp", "-C", "apps/auth", "run", "migrate"], check=True, env=ENV)
    if ENV["AUTH_MODE"] == "password" and ENV["QUOREM_DEV_IDENTITY"] != "true":
        subprocess.run(["vp", "-C", "apps/auth", "run", "seed"], check=True, env=ENV)
    for command in [
        ["vp", "exec", "node", "--input-type=module", "-e", "import {localSqsFixture} from './apps/api/src/runtime/composition/fixtures/local-sqs.ts'; localSqsFixture().server.listen(Number(process.argv[1]),process.argv[2])", str(queue_port), queue_endpoint.hostname],
        ["vp", "-C", "apps/runner", "run", "verifier"],
        ["vp", "-C", "apps/marketing", "run", "dev", "--port", str(urlparse(ENV["QUOREM_MARKETING_DEV_ORIGIN"]).port or 4321)],
        ["vp", "-C", "apps/api", "run", "start"],
        ["vp", "-C", "apps/runner", "run", "runner"],
        *language_services,
        ["vp", "-C", "apps/web", "dev", "--host", "127.0.0.1", "--port", str(urlparse(ENV["WEB_ORIGIN"]).port or 5173), "--strictPort"],
    ]:
        processes.append(subprocess.Popen(command, env=ENV, start_new_session=True))
    print(f"Web {ENV['WEB_ORIGIN']} | API {ENV['API_ADDR']} | language {ENV['LANGUAGE_ADDR'] if hosted_intelligence else 'disabled'}", flush=True)
    while all(process.poll() is None for process in processes):
        time.sleep(0.25)
    raise SystemExit(next(process.returncode for process in processes if process.poll() is not None))
except KeyboardInterrupt:
    pass
finally:
    for process in processes:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
    for process in processes:
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
