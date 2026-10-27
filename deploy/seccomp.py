"""Restrict kernel interfaces available to contestant processes."""
import ctypes
import errno


class Comparison(ctypes.Structure):
    _fields_ = [('arg', ctypes.c_uint), ('op', ctypes.c_int), ('a', ctypes.c_uint64), ('b', ctypes.c_uint64)]


def install():
    lib = ctypes.CDLL('libseccomp.so.2')
    lib.seccomp_init.argtypes = [ctypes.c_uint32]
    lib.seccomp_init.restype = ctypes.c_void_p
    lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    lib.seccomp_syscall_resolve_name.restype = ctypes.c_int
    lib.seccomp_rule_add_array.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint, ctypes.POINTER(Comparison)]
    lib.seccomp_load.argtypes = [ctypes.c_void_p]
    lib.seccomp_release.argtypes = [ctypes.c_void_p]
    context = lib.seccomp_init(0x7fff0000)
    if not context:
        raise RuntimeError('seccomp unavailable')
    try:
        def deny(name, error=errno.EPERM, comparisons=()):
            number = lib.seccomp_syscall_resolve_name(name.encode())
            if number < 0:
                return
            arguments = (Comparison * len(comparisons))(*comparisons)
            if lib.seccomp_rule_add_array(context, 0x00050000 | error, number, len(comparisons), arguments) != 0:
                raise RuntimeError('seccomp rule failed')
        for name in ('mount', 'umount2', 'pivot_root', 'setns', 'unshare', 'ptrace',
                     'process_vm_readv', 'process_vm_writev', 'pidfd_getfd', 'bpf',
                     'perf_event_open', 'keyctl', 'add_key', 'request_key',
                     'open_by_handle_at', 'init_module', 'finit_module', 'delete_module',
                     'kexec_load', 'kexec_file_load', 'reboot', 'swapon', 'swapoff',
                     'io_uring_setup', 'userfaultfd'):
            deny(name)
        # glibc retries clone when clone3 is unavailable. Namespace creation stays forbidden.
        deny('clone3', errno.ENOSYS)
        for flag in (0x00020000, 0x02000000, 0x04000000, 0x08000000, 0x10000000, 0x20000000, 0x40000000):
            deny('clone', comparisons=(Comparison(0, 7, flag, flag),))
        if lib.seccomp_load(context) != 0:
            raise RuntimeError('seccomp load failed')
    finally:
        lib.seccomp_release(context)
