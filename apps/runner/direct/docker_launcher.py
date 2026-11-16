"""Run the local Docker harness under the shared CPU supervisor."""
import os
from pathlib import Path
import signal
import sys

from case_supervisor import stage_input, supervise


def stop_children():
    try:
        os.kill(-1, signal.SIGKILL)
    except ProcessLookupError:
        pass


def run(cpu_ms, compile_ms, compiled):
    if os.getpid() != 1 or os.getuid() != 0:
        raise RuntimeError('supervisor requires a private container')
    stage_input()
    output, sink = os.pipe()
    child = os.fork()
    if child:
        os.close(sink)
        return supervise(child, Path('/sys/fs/cgroup'), output, compiled,
                         cpu_ms, compile_ms, stop_children)
    try:
        os.close(output)
        os.dup2(sink, 1)
        os.close(sink)
        os.setgroups([])
        os.setresgid(65534, 65534, 65534)
        os.setresuid(65534, 65534, 65534)
        os.execv(sys.executable, [sys.executable, '-B', '/opt/quorem/harness.py'])
    finally:
        os._exit(125)


if __name__ == '__main__':
    try:
        result = run(int(sys.argv[1]), int(sys.argv[2]), sys.argv[3] == 'compiled')
        sys.exit(result if result >= 0 else 128 - result)
    except Exception:
        print('case supervision failed', file=sys.stderr, flush=True)
        sys.exit(125)
