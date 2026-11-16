"""Trusted case CPU accounting and output forwarding."""
import os
from select import select
import shutil
import sys
import time


def stage_input():
    """Finish receiving the case before any contestant timing starts."""
    with os.fdopen(os.memfd_create('case-input'), 'w+b') as target:
        shutil.copyfileobj(sys.stdin.buffer, target)
        target.seek(0)
        os.dup2(target.fileno(), 0)


def cpu_micros(group):
    for line in (group / 'cpu.stat').read_text().splitlines():
        key, value = line.split()
        if key == 'usage_usec':
            return int(value)
    raise RuntimeError('case CPU accounting unavailable')


def supervise(child, group, output, compiled, cpu_ms, compile_ms, stop):
    """Measure cgroup CPU while independently relaying bounded output."""
    markers = 2 if compiled else 1
    phase = 125
    baseline = None
    deadline = time.monotonic() + 45
    status = None
    pending = b''
    eof = False
    os.set_blocking(output, False)
    os.set_blocking(1, False)
    try:
        while not eof or pending or status is None:
            # Apply backpressure without charging the relay to the case cgroup.
            readable, writable, _ = select(
                [output] if not eof and not pending else [],
                [1] if pending else [], [], 0.004,
            )
            if readable:
                pending = os.read(output, 1 if markers else 65536)
                eof = not pending
                if markers and pending:
                    if pending != b'\0':
                        raise RuntimeError('invalid readiness marker')
                    markers -= 1
                    used = cpu_micros(group)
                    if compiled and not markers:
                        # The trusted prefix retains compile CPU before the execution baseline resets.
                        if used - baseline >= compile_ms * 1000:
                            stop()
                            os.waitpid(child, 0)
                            return 123
                        pending += ((used - baseline + 999) // 1000).to_bytes(4, 'big')
                    phase = 123 if markers else 124
                    budget = compile_ms if markers else cpu_ms
                    baseline = used
                    deadline = time.monotonic() + (
                        10 + budget / 1000 if markers else max(2, 4 * budget / 1000))
            if writable:
                pending = pending[os.write(1, pending):]
            if status is None:
                pid, result = os.waitpid(child, os.WNOHANG)
                cpu_exceeded = baseline is not None and cpu_micros(group) - baseline >= budget * 1000
                if pid:
                    status = phase if cpu_exceeded else os.waitstatus_to_exitcode(result)
                    if not cpu_exceeded and (121 <= status <= 124 or (status == 125 and phase != 125)):
                        status = 1
                    stop()
                elif cpu_exceeded or time.monotonic() >= deadline:
                    stop()
                    os.waitpid(child, 0)
                    if cpu_exceeded or phase == 125:
                        return phase
                    return 125 if pending else phase - 2
        return status
    except Exception:
        stop()
        if status is None:
            try:
                os.waitpid(child, 0)
            except ChildProcessError:
                pass
        raise
    finally:
        os.close(output)
        os.set_blocking(1, True)
