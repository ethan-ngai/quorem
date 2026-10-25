"""Supervise trusted services; contestant code runs only inside bounded inner containers."""
from pathlib import Path
import argparse
import signal
import subprocess
import time

processes = []
parser = argparse.ArgumentParser()
parser.add_argument("--verify-only", action="store_true")
arguments = parser.parse_args()


def stop(_signal=None, _frame=None):
    raise SystemExit(0)


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    processes.append(subprocess.Popen([
        "dockerd", "--iptables=false", "--ip6tables=false", "--ip-forward=false",
        "--bridge=none", "--storage-driver=vfs", "--host=unix:///var/run/docker.sock",
        "--exec-opt", "native.cgroupdriver=cgroupfs",
    ]))
    for _ in range(150):
        if subprocess.run(["docker", "info"], stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL).returncode == 0:
            break
        if processes[0].poll() is not None:
            raise RuntimeError("Docker daemon exited")
        time.sleep(0.2)
    else:
        raise RuntimeError("Docker daemon unavailable")
    for image in sorted(Path("/app/images").glob("*.tar")):
        subprocess.run(["docker", "load", "-i", str(image)], check=True)
    subprocess.run(["/app/bin/runner", "--verify-sandbox"], check=True)
    if arguments.verify_only:
        raise SystemExit(0)
    subprocess.run(["/app/bin/provision"], check=True)
    subprocess.run(["node", "--experimental-strip-types", "apps/auth/src/migrate.ts"], check=True)
    for command in (
        ["/app/bin/api"],
        ["node", "--experimental-strip-types", "apps/auth/src/server.ts"],
        ["/app/bin/runner"],
    ):
        processes.append(subprocess.Popen(command))
    processes.append(subprocess.Popen(["nginx", "-c", "/app/deploy/nginx.conf", "-g", "daemon off;"]))
    while all(p.poll() is None for p in processes):
        time.sleep(0.5)
    raise RuntimeError("Production service exited")
finally:
    for process in reversed(processes):
        if process.poll() is None:
            process.terminate()
    deadline = time.monotonic() + 10
    for process in processes:
        try:
            process.wait(timeout=max(0.1, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            process.kill()
