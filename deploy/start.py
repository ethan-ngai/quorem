"""Supervise API/auth only; schema changes run once in GitHub Actions before rollout."""
import argparse
import signal
import subprocess
import time
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--verify-only', action='store_true')
arguments = parser.parse_args()
if arguments.verify_only:
    subprocess.run(['/app/bin/api', '--help'], check=True)
    subprocess.run(['node', '--check', '--experimental-strip-types', 'apps/auth/src/server.ts'], check=True)
    raise SystemExit(0)

processes = []
def stop(_signal=None, _frame=None):
    raise SystemExit(0)
signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    for command in (
        ['/app/bin/api'],
        ['node', '--experimental-strip-types', 'apps/auth/src/server.ts'],
    ):
        processes.append(subprocess.Popen(command))
    pending = {'http://127.0.0.1:8080/health', 'http://127.0.0.1:8082/api/auth/quorem-config'}
    deadline = time.monotonic() + 55
    while pending and time.monotonic() < deadline:
        if any(process.poll() is not None for process in processes):
            raise RuntimeError('Application service exited before readiness')
        for endpoint in list(pending):
            try:
                with urllib.request.urlopen(endpoint, timeout=1) as response:
                    if response.status == 200:
                        pending.remove(endpoint)
            except OSError:
                pass
        if pending:
            time.sleep(0.1)
    if pending:
        raise RuntimeError('API/auth readiness timed out')
    processes.append(subprocess.Popen(['nginx', '-c', '/app/deploy/nginx.conf', '-g', 'daemon off;']))
    while all(process.poll() is None for process in processes):
        time.sleep(0.5)
    raise RuntimeError('Application service exited')
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
