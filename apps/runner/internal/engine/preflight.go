package engine

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/worker"
	"github.com/ethan-ngai/quorem/internal/execution"
)

const isolationProbe = `import os,socket,pathlib,subprocess,errno
class Solution:
 def probe(self):
  assert os.getuid()==65534 and os.getgid()==65534 and os.getpid()==1
  status=dict(line.split(':',1) for line in pathlib.Path('/proc/self/status').read_text().splitlines() if ':' in line)
  assert int(status['CapEff'].strip(),16)==0 and status['NoNewPrivs'].strip()=='1'
  assert os.statvfs('/').f_flag & os.ST_RDONLY
  assert not os.path.exists('/var/run/docker.sock') and not os.path.exists('/app')
  assert not any(k in os.environ for k in ['DATABASE_URL','AUTH_DATABASE_URL','BETTER_AUTH_SECRET','AUTH_INTERNAL_SECRET','QUOREM_INVITE_KEY'])
  assert set(os.listdir('/sys/class/net'))=={'lo'}
  try:
   socket.create_connection(('1.1.1.1',443),timeout=.1)
   raise AssertionError('network enabled')
  except OSError: pass
  mounts=pathlib.Path('/proc/mounts').read_text().splitlines()
  tmp=next(line.split()[3].split(',') for line in mounts if line.split()[1]=='/tmp')
  assert 'noexec' in tmp and 'nosuid' in tmp
  cg=pathlib.Path('/sys/fs/cgroup')
  assert int((cg/'memory.max').read_text())==MEMORY_LIMIT
  assert int((cg/'memory.swap.max').read_text())==0
  assert int((cg/'pids.max').read_text())==PID_LIMIT
  quota,period=map(int,(cg/'cpu.max').read_text().split())
  assert 0<quota<=period
  children=[]
  try:
   for _ in range(PID_LIMIT*2):
    try: children.append(subprocess.Popen(['sleep','5']))
    except OSError as e:
     assert e.errno==errno.EAGAIN
     break
   else: raise AssertionError('PID limit unenforced')
  finally:
   for child in children: child.kill()
   for child in children: child.wait()
  return 1
`

// VerifySandbox runs the real admission engine before a cloud host may claim jobs.
func (d *Docker) VerifySandbox(ctx context.Context) error {
	fixture := worker.Fixture{}
	fixture.Problem.Signature.ClassName = "Solution"
	fixture.Problem.Signature.MethodName = "probe"
	fixture.Problem.Signature.ReturnType = "int"
	fixture.Problem.Signature.Parameters = []worker.Parameter{}
	test := worker.Case{Args: []json.RawMessage{}, Expected: json.RawMessage("1")}
	limits := execution.DefaultLimits()
	for _, probe := range []struct {
		name, source string
		verdict      execution.Verdict
	}{
		{"isolation", fmt.Sprintf("MEMORY_LIMIT=%d\nPID_LIMIT=%d\n", limits.MemoryBytes, limits.MaxProcesses) + isolationProbe, execution.Accepted},
		{"memory", fmt.Sprintf("class Solution:\n def probe(self): return len(bytearray(%d))", limits.MemoryBytes*4), execution.MemoryLimit},
		{"deadline", "class Solution:\n def probe(self):\n  while True: pass", execution.TimeLimit},
		{"output", fmt.Sprintf("class Solution:\n def probe(self): print('x'*%d); return 1", limits.OutputBytes+1024), execution.OutputLimit},
	} {
		engine := *d
		engine.Resolve = func(context.Context, execution.Job) (worker.Spec, error) {
			return worker.Spec{Source: probe.source, Kind: "run", Fixture: fixture, Cases: []worker.Case{test}}, nil
		}
		attempt := "preflight-" + rand.Text()
		job := execution.Job{AttemptID: attempt, SubmissionID: attempt, Language: "python", RuntimeRevision: execution.RuntimeRevision, HarnessRevision: execution.HarnessRevision, Limits: execution.DefaultLimits()}
		bounded, cancel := context.WithTimeout(ctx, 20*time.Second)
		result, err := engine.Execute(bounded, job)
		cancel()
		if err != nil {
			return fmt.Errorf("sandbox %s: %w", probe.name, err)
		}
		if result.Verdict != probe.verdict {
			return fmt.Errorf("sandbox %s: expected %s, got %s (%+v)", probe.name, probe.verdict, result.Verdict, result.PublicCaseResults)
		}
		remaining, err := exec.CommandContext(ctx, "docker", "ps", "-a", "--filter", "name=^/quorem-"+attempt+"-", "--format", "{{.Names}}").Output()
		if err != nil || strings.TrimSpace(string(remaining)) != "" {
			return fmt.Errorf("sandbox %s teardown unconfirmed", probe.name)
		}
	}
	return nil
}
