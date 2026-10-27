"""Exercise the direct-case launcher in a disposable privileged Docker container."""
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent
IMAGE = os.environ.get('QUOREM_DIRECT_TEST_IMAGE', 'quorem-python:local')
SOURCE = '''import os,socket,pathlib
class Solution:
 def solve(self):
  status=dict(line.split(':',1) for line in pathlib.Path('/proc/self/status').read_text().splitlines() if ':' in line)
  assert os.getpid()==1 and os.getuid()==65534 and os.getgid()==65534
  assert int(status['CapEff'],16)==0 and int(status['CapPrm'],16)==0 and status['NoNewPrivs'].strip()=='1'
  assert status['Seccomp'].strip()=='2'
  import ctypes
  libc=ctypes.CDLL(None,use_errno=True)
  assert libc.ptrace(0,0,0,0)==-1 and ctypes.get_errno()==1
  assert os.statvfs('/').f_flag & os.ST_RDONLY
  assert {n for _,n in socket.if_nameindex()} == {'lo'}
  assert pathlib.Path('/sys/fs/cgroup/memory.max').read_text().strip()=='268435456'
  assert pathlib.Path('/sys/fs/cgroup/pids.max').read_text().strip()=='16'
  assert pathlib.Path('/sys/fs/cgroup/memory.swap.max').read_text().strip()=='0'
  assert not any(k in os.environ for k in ['DATABASE_URL','AUTH_INTERNAL_SECRET','QUOREM_JUDGE_CONTROL_TOKEN'])
  import subprocess,errno
  children=[]
  try:
   for _ in range(32):
    try: children.append(subprocess.Popen(['sleep','5']))
    except OSError as error:
     assert error.errno == errno.EAGAIN
     break
   else: raise AssertionError('process limit not enforced')
  finally:
   for child in children: child.kill()
   for child in children: child.wait()
  open('/tmp/test','w').write('ok')
  return 7'''


def invoke(source, privileged=True, language='python', args=None):
    request = json.dumps({'source': source, 'signature': {'parameters': [], 'methodName': 'solve', 'returnType': 'int'}, 'args': args or []}).encode()
    command = ['docker', 'run', '-i', '--rm', '--user', '0:0', '--cgroupns=private', '--network=none']
    if privileged:
        command.append('--privileged')
    command.extend(['-v', str(ROOT / 'deploy/cgroup.py') + ':/opt/quorem/cgroup.py:ro',
                    '-v', str(ROOT / 'deploy/seccomp.py') + ':/opt/quorem/seccomp.py:ro',
                    '-v', str(ROOT / 'apps/runner/direct/launcher.py') + ':/opt/quorem/launcher.py:ro',
                    '--env', 'QUOREM_JUDGE_CONTROL_TOKEN=should-not-reach-case',
                    '--entrypoint', 'python3', IMAGE if language == 'python' else 'quorem-postgres:local', '/opt/quorem/launcher.py', language, '268435456', '16' if language == 'python' else '64'])
    return subprocess.run(command, input=request, capture_output=True, timeout=30)


def main():
    good = invoke(SOURCE)
    if good.returncode != 0 or not good.stdout.startswith(b'\0'):
        raise RuntimeError('Direct sandbox failed to execute')
    result = json.loads(good.stdout[1:])
    if result.get('status') != 'executed' or result.get('actual') != 7:
        raise RuntimeError('Direct sandbox isolation check failed: ' + str(result))
    denied = invoke('class Solution:\n def solve(self): return 7', privileged=False)
    if denied.returncode != 125 or denied.stdout:
        raise RuntimeError('Direct sandbox accepted unavailable isolation')
    memory = invoke('class Solution:\n def solve(self): return len(bytearray(1024 * 1024 * 1024))')
    if memory.returncode != 137:
        raise RuntimeError('Direct sandbox did not enforce the memory limit')
    tables = [{'tables': [{'name': 'items', 'columns': [{'name': 'id', 'type': 'integer'}], 'rows': [[1]]}]}]
    sql = invoke('SELECT id FROM items', language='postgresql', args=tables)
    if sql.returncode or not sql.stdout.startswith(b'\0') or json.loads(sql.stdout[1:]).get('status') != 'executed':
        raise RuntimeError('Direct PostgreSQL sandbox failed')
    sql_denied = invoke("RESET SESSION AUTHORIZATION; COPY items TO PROGRAM 'id'", language='postgresql', args=tables)
    if sql_denied.returncode or not sql_denied.stdout.startswith(b'\0') or json.loads(sql_denied.stdout[1:]).get('status') != 'runtime_error':
        raise RuntimeError('Direct PostgreSQL sandbox allowed privileged SQL')
    print('Direct sandbox isolation and fail-closed setup passed')


if __name__ == '__main__':
    main()
