"""Delegate cgroup v2 controllers to isolated child workloads."""
import errno
from pathlib import Path
import time


def enable(root=Path('/sys/fs/cgroup')):
    if not (root / 'cgroup.controllers').exists():
        raise RuntimeError('cgroup v2 unavailable')
    init = root / 'init'
    init.mkdir(exist_ok=True)
    for attempt in range(20):
        for pid in (root / 'cgroup.procs').read_text().split():
            try:
                (init / 'cgroup.procs').write_text(pid)
            except OSError as error:
                if error.errno != errno.ESRCH:
                    raise
        controllers = (root / 'cgroup.controllers').read_text().split()
        try:
            (root / 'cgroup.subtree_control').write_text(' '.join('+' + name for name in controllers))
            return
        except OSError as error:
            if error.errno != errno.EBUSY or attempt == 19:
                raise
            time.sleep(0.05)
