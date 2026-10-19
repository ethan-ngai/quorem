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
ENV.setdefault("DATABASE_URL", "postgres://quorem:quorem@localhost:54329/quorem?sslmode=disable")
ENV.setdefault("API_ADDR", "127.0.0.1:8080")
ENV.setdefault("LANGUAGE_ADDR", "127.0.0.1:8081")
ENV.setdefault("WEB_ORIGIN", "http://localhost:5173")
ENV.setdefault("QUOREM_MARKETING_BASE", "/_marketing")
ENV.setdefault("QUOREM_MARKETING_DEV_ORIGIN", "http://127.0.0.1:4321")
ENV.setdefault("LANGUAGE_URL", "http://127.0.0.1:8081")
ENV.setdefault("AUTH_MODE", "password")
ENV.setdefault("AUTH_ORIGIN", ENV["WEB_ORIGIN"])
ENV.setdefault("AUTH_DATABASE_URL", ENV["DATABASE_URL"])
ENV.setdefault("AUTH_SERVICE_URL", "http://127.0.0.1:8082")
ENV.setdefault("AUTH_PORT", str(urlparse(ENV["AUTH_SERVICE_URL"]).port or 8082))
ENV.setdefault("API_IDENTITY_URL", f"http://{ENV['API_ADDR']}")
ENV.setdefault("VITE_LANGUAGE_URL", f"ws://{ENV['LANGUAGE_ADDR']}/lsp")
ENV.setdefault("QUOREM_API_DEV_ORIGIN", f"http://{ENV['API_ADDR']}")
ENV.setdefault("QUOREM_AUTH_DEV_ORIGIN", ENV["AUTH_SERVICE_URL"])
if ENV["QUOREM_ENV"] != "development" or ENV["APP_ENV"] != "local":
    raise SystemExit("make dev requires QUOREM_ENV=development and APP_ENV=local")

# Persist generated credentials across restarts, outside source control.
if ENV["QUOREM_DEV_IDENTITY"] != "true" and ENV["AUTH_MODE"] == "password":
    credential_file = ROOT / ".local/auth-preview.json"
    credential_file.parent.mkdir(parents=True, exist_ok=True)
    if not credential_file.exists():
        values = {key: secrets.token_urlsafe(32) for key in (
            "BETTER_AUTH_SECRET", "AUTH_INTERNAL_SECRET", "AUTH_SEED_PASSWORD"
        )}
        descriptor = os.open(credential_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as stream:
            json.dump(values, stream, indent=2)
    for key, value in json.loads(credential_file.read_text()).items():
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
        ["go", "build", "-o", ".local/bin/language", "./apps/language/cmd/language"],
    ]
    language_services = [["vp", "run", "--filter", "@quorem/language", "dev:node"]
                         if ENV.get("LANGUAGE_GATEWAY") == "node" else [".local/bin/language"]]
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
        *[["docker", "build", "-f", f"apps/runner/Dockerfile.{language}", "-t", f"quorem-{language}:local", "."] for language in ("java", "typescript", "ocaml")],
        *language_builds,
        ["go", "build", "-o", ".local/bin/api", "./apps/api/cmd/api"],
        ["go", "build", "-o", ".local/bin/runner", "./apps/runner/cmd/runner"],
    ]:
        subprocess.run(command, check=True, env=ENV)
    if ENV["QUOREM_DEV_IDENTITY"] != "true":
        subprocess.run([".local/bin/api", "--seed"], check=True, env=ENV)
        subprocess.run(["vp", "-C", "apps/auth", "run", "migrate"], check=True, env=ENV)
        if ENV["AUTH_MODE"] == "password":
            subprocess.run(["vp", "-C", "apps/auth", "run", "seed"], check=True, env=ENV)
        processes.append(subprocess.Popen(["vp", "-C", "apps/auth", "run", "dev"], env=ENV, start_new_session=True))
    for command in [
        ["vp", "-C", "apps/marketing", "run", "dev", "--port", str(urlparse(ENV["QUOREM_MARKETING_DEV_ORIGIN"]).port or 4321)],
        [".local/bin/api"],
        [".local/bin/runner"],
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
