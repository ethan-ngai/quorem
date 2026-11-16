"""Exercise concurrent launchers and case cancellation inside a real Linux container."""
import json
import subprocess
import time
from pathlib import Path

LAUNCHER = ['python3', '-B', '/opt/quorem/launcher.py']
SLOW = '11111111-1111-4111-8111-111111111111'
FAST = '22222222-2222-4222-8222-222222222222'


def case(token, body):
    source = 'import os, time\nclass Solution:\n def solve(self):\n' + body
    payload = json.dumps({
        'source': source,
        'signature': {'parameters': [], 'methodName': 'solve', 'returnType': 'int'},
        'args': [],
    }).encode()
    process = subprocess.Popen(
        [*LAUNCHER, 'python', '268435456', '16', '500', '60000', token],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    process.stdin.write(payload)
    process.stdin.close()
    process.stdin = None
    return process


slow = case(SLOW, '  open("/tmp/private-marker", "w").close()\n  time.sleep(10)\n  return 1')
try:
    group = Path('/sys/fs/cgroup', 'case-' + SLOW)
    deadline = time.monotonic() + 3
    # Read the private mount through the trusted supervisor's process view.
    while True:
        pids = (group / 'cgroup.procs').read_text().split() if group.exists() else []
        if any(Path('/proc', pid, 'root/tmp/private-marker').exists() for pid in pids):
            break
        assert time.monotonic() < deadline, 'case did not start'
        time.sleep(0.01)
    fast = case(FAST, '  return int(os.path.exists("/tmp/private-marker"))')
    stdout, stderr = fast.communicate(timeout=5)
    assert fast.returncode == 0 and json.loads(stdout[1:])['actual'] == 0, (stdout, stderr)
    assert slow.poll() is None
    subprocess.run([*LAUNCHER, 'cancel', SLOW], check=True, timeout=5)
    assert slow.wait(timeout=2) == 137
    assert not Path('/sys/fs/cgroup', 'case-' + SLOW).exists()
finally:
    if slow.poll() is None:
        subprocess.run([*LAUNCHER, 'cancel', SLOW], timeout=5)


for body, limit_status in [('  while True: pass', 124), ('  time.sleep(10)', 122)]:
    process = case('33333333-3333-4333-8333-333333333333', body)
    output, diagnostics = process.communicate(timeout=5)
    assert process.returncode == limit_status and output == b'\0', (output, diagnostics)
