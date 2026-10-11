"""Run local services; terminate every child when one exits."""

import os
from pathlib import Path
import signal
import subprocess
import time

ROOT = Path(__file__).resolve().parent.parent
os.chdir(ROOT)
ENV = os.environ.copy()
ENV.setdefault("QUOREM_ENV", "development")
ENV.setdefault("APP_ENV", "local")
ENV.setdefault("QUOREM_DEV_IDENTITY", "true")
ENV.setdefault("DATABASE_URL", "postgres://quorem:quorem@localhost:54329/quorem?sslmode=disable")
ENV.setdefault("API_ADDR", "127.0.0.1:8080")
ENV.setdefault("LANGUAGE_ADDR", "127.0.0.1:8081")
ENV.setdefault("WEB_ORIGIN", "http://localhost:5173")
ENV.setdefault("LANGUAGE_URL", "http://127.0.0.1:8081")
if ENV["QUOREM_ENV"] != "development" or ENV["APP_ENV"] != "local":
    raise SystemExit("make dev requires QUOREM_ENV=development and APP_ENV=local")

processes = []


def stop(_signal, _frame):
    raise KeyboardInterrupt


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    Path(".local/bin").mkdir(parents=True, exist_ok=True)
    for command in [
        ["vp", "-C", "apps/marketing", "run", "build"],
        ["docker", "compose", "up", "-d", "--wait"],
        ["docker", "build", "-f", "apps/runner/Dockerfile", "-t", "quorem-python:local", "."],
        ["docker", "build", "-f", "apps/language/Dockerfile", "-t", "quorem-language:local", "."],
        ["go", "build", "-o", ".local/bin/api", "./apps/api/cmd/api"],
        ["go", "build", "-o", ".local/bin/runner", "./apps/runner/cmd/runner"],
    ]:
        subprocess.run(command, check=True, env=ENV)
    for command in [
        [".local/bin/api"],
        [".local/bin/runner"],
        ["vp", "run", "--filter", "@quorem/language", "dev"],
        ["vp", "-C", "apps/web", "dev", "--host", "127.0.0.1", "--port", "5173", "--strictPort"],
    ]:
        processes.append(subprocess.Popen(command, env=ENV, start_new_session=True))
    print("Web http://localhost:5173 | API :8080 | language :8081", flush=True)
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
