"""Judge-only host: verify isolation before starting the authenticated drain service."""
from pathlib import Path
import argparse
import errno
import signal
import subprocess
import time
import os

processes = []
parser = argparse.ArgumentParser()
parser.add_argument("--verify-only", action="store_true")
arguments = parser.parse_args()


def stop(_signal=None, _frame=None):
    raise SystemExit(0)


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    for identity in ("self", "1"):
        print(f"cgroup {identity}: " + Path(f"/proc/{identity}/cgroup").read_text().strip(), flush=True)
    for line in Path("/proc/self/mountinfo").read_text().splitlines():
        if " - cgroup" in line:
            print("cgroup mount: " + line, flush=True)
    # Moby's dind setup: domain controllers require an empty parent cgroup.
    cgroup = Path("/sys/fs/cgroup")
    if (cgroup / "cgroup.controllers").exists():
        (cgroup / "init").mkdir(exist_ok=True)
        for attempt in range(20):
            for pid in (cgroup / "cgroup.procs").read_text().split():
                try:
                    (cgroup / "init/cgroup.procs").write_text(pid)
                except OSError as error:
                    if error.errno != errno.ESRCH:
                        raise
            controllers = (cgroup / "cgroup.controllers").read_text().split()
            try:
                (cgroup / "cgroup.subtree_control").write_text(" ".join("+" + name for name in controllers))
                break
            except OSError as error:
                if error.errno != errno.EBUSY or attempt == 19:
                    raise
                time.sleep(0.05)
    processes.append(subprocess.Popen([
        "dockerd", "--iptables=false", "--ip6tables=false", "--ip-forward=false",
        "--bridge=none", "--host=unix:///var/run/docker.sock",
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
    # Verify both sandbox families before accepting jobs; other runtimes load on demand.
    for language in ("python", "postgres"):
        subprocess.run(["docker", "load", "-i", f"/app/images/{language}.tar"], check=True)
    subprocess.run(["/app/bin/runner", "--verify-sandbox"], check=True)
    if arguments.verify_only:
        raise SystemExit(0)
    if any(os.environ.get(name) for name in ("BETTER_AUTH_SECRET","AUTH_INTERNAL_SECRET","QUOREM_INVITE_KEY","AUTH_DATABASE_URL")):
        raise RuntimeError("Judge must not receive application credentials")
    processes.append(subprocess.Popen(["/app/bin/runner", "--http"]))
    while all(p.poll() is None for p in processes):
        time.sleep(0.5)
    raise RuntimeError("Production service exited")
finally:
    # Keep Docker available until runner cancellation has fenced and torn down active attempts.
    for process in reversed(processes[1:]):
        if process.poll() is None:
            process.terminate()
    deadline = time.monotonic() + 30
    for process in processes[1:]:
        try:
            process.wait(timeout=max(0.1, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            process.kill()
    if processes:
        daemon = processes[0]
        if daemon.poll() is None:
            daemon.terminate()
        try:
            daemon.wait(timeout=10)
        except subprocess.TimeoutExpired:
            daemon.kill()
