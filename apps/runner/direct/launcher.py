"""Fail-closed per-case Linux isolation, executed in a disposable container."""
import ctypes
import os
from pathlib import Path
import resource
import sys

from cgroup import enable
from seccomp import install

libc = ctypes.CDLL(None, use_errno=True)
CLONE_NEWNS = 0x00020000
CLONE_NEWNET = 0x40000000
CLONE_NEWPID = 0x20000000
CLONE_NEWCGROUP = 0x02000000
MS_RDONLY = 1
MS_NOSUID = 2
MS_NODEV = 4
MS_NOEXEC = 8
MS_REMOUNT = 32
MS_PRIVATE = 1 << 18
MS_REC = 16384
PR_CAPBSET_DROP = 24
PR_SET_NO_NEW_PRIVS = 38


def call(function, *args):
    if function(*args) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))


def mount(source, target, filesystem, flags, data=None):
    def value(text):
        return text.encode() if text is not None else None
    call(libc.mount, value(source), value(target), value(filesystem), ctypes.c_ulong(flags), value(data))


def prepare_cgroup(memory, processes):
    root = Path('/sys/fs/cgroup')
    enable(root)
    group = root / 'case'
    group.mkdir(exist_ok=False)
    for name, value in (
        ('memory.max', str(memory)), ('memory.swap.max', '0'),
        ('pids.max', str(processes)), ('cpu.max', '100000 100000'),
    ):
        (group / name).write_text(value)
    return group


def run(language, memory, processes):
    if language not in ('python', 'java', 'typescript', 'ocaml', 'postgresql'):
        raise ValueError('unsupported language')
    if not 1 <= memory <= 12 * 1024**3 or not 1 <= processes <= 1024:
        raise ValueError('invalid resource limits')
    group = prepare_cgroup(memory, processes)
    # The parent stays outside the PID and resource namespaces and never reads case input.
    call(libc.unshare, CLONE_NEWPID)
    child = os.fork()
    if child:
        _, status = os.waitpid(child, 0)
        return os.waitstatus_to_exitcode(status)
    try:
        (group / 'cgroup.procs').write_text(str(os.getpid()))
        call(libc.unshare, CLONE_NEWNS | CLONE_NEWNET | CLONE_NEWCGROUP)
        mount(None, '/', None, MS_REC | MS_PRIVATE)
        call(libc.umount2, b'/proc', 2)
        mount('proc', '/proc', 'proc', MS_RDONLY | MS_NOSUID | MS_NODEV | MS_NOEXEC)
        call(libc.umount2, b'/sys', 2)
        mount('sysfs', '/sys', 'sysfs', MS_RDONLY | MS_NOSUID | MS_NODEV | MS_NOEXEC)
        mount('cgroup2', '/sys/fs/cgroup', 'cgroup2', MS_RDONLY | MS_NOSUID | MS_NODEV | MS_NOEXEC)
        mount('tmpfs', '/run', 'tmpfs', MS_NOSUID | MS_NODEV | MS_NOEXEC, 'size=1048576,mode=0755')
        mount('tmpfs', '/tmp', 'tmpfs', MS_NOSUID | MS_NOEXEC, 'size=134217728' if language == 'postgresql' else 'size=16777216')
        mount(None, '/', None, MS_REMOUNT | MS_RDONLY)
        for cap in range(64):
            if libc.prctl(PR_CAPBSET_DROP, cap, 0, 0, 0) != 0 and ctypes.get_errno() != 22:
                raise OSError(ctypes.get_errno(), 'capability drop failed')
        os.setgroups([])
        os.setresgid(65534, 65534, 65534)
        os.setresuid(65534, 65534, 65534)
        call(libc.prctl, PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)
        install()
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        status = dict(line.split(':', 1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
        if int(status['CapEff'].strip(), 16) or int(status['CapPrm'].strip(), 16) or status['NoNewPrivs'].strip() != '1' or status['Seccomp'].strip() != '2':
            raise RuntimeError('privilege reduction failed')
        env = {'PATH': '/opt/java/openjdk/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/tmp', 'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONUNBUFFERED': '1'}
        if language in ('java', 'typescript', 'ocaml'):
            env['QUOREM_LANGUAGE'] = language
        os.chdir('/tmp')
        python = '/usr/local/bin/python3' if os.access('/usr/local/bin/python3', os.X_OK) else '/usr/bin/python3'
        os.execve(python, [python, '-B', '/opt/quorem/harness.py'], env)
    except Exception as error:
        print('case isolation failed: ' + type(error).__name__, file=sys.stderr, flush=True)
        os._exit(125)


if __name__ == '__main__':
    try:
        result = run(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]))
        sys.exit(result if result >= 0 else 128 - result)
    except Exception as error:
        print('case isolation failed: ' + type(error).__name__, file=sys.stderr, flush=True)
        sys.exit(125)
