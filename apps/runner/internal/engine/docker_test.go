package engine

import (
	"context"
	"encoding/json"
	"github.com/ethan-ngai/quorem/apps/api/worker"
	"github.com/ethan-ngai/quorem/internal/execution"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"testing"
	"time"
)

func dockerTests(t *testing.T) []worker.Fixture {
	t.Helper()
	if os.Getenv("QUOREM_TEST_DOCKER") != "1" {
		t.Skip("QUOREM_TEST_DOCKER=1 enables development Docker integration")
	}
	f, err := worker.LoadFixtures("../../../../fixtures/problems")
	if err != nil {
		t.Fatal(err)
	}
	return f
}
func executeFixture(t *testing.T, f worker.Fixture, source, kind string, cases []worker.Case) execution.Completion {
	t.Helper()
	docker := &Docker{Image: "quorem-python:local", Resolve: func(context.Context, execution.Job) (worker.Spec, error) {
		return worker.Spec{Source: source, Kind: kind, Fixture: f, Cases: cases}, nil
	}}
	j := execution.Job{JobID: "test", SubmissionID: "test", AttemptID: time.Now().Format("150405.000000000"), RuntimeRevision: execution.RuntimeRevision, HarnessRevision: execution.HarnessRevision, Limits: execution.DefaultLimits()}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	result, err := docker.Execute(ctx, j)
	if err != nil {
		t.Fatal(err)
	}
	return result
}
func TestDockerReferenceCorpus(t *testing.T) {
	fixtures := dockerTests(t)
	for _, f := range fixtures {
		t.Run(f.Problem.Slug, func(t *testing.T) {
			result := executeFixture(t, f, f.ReferenceSource, "submit", f.HiddenCases)
			if result.Verdict != execution.Accepted || result.Score == nil || result.Score.Passed != 20 || len(result.PublicCaseResults) != 0 {
				t.Fatal(result)
			}
		})
	}
}
func TestDockerFailuresAndUncomparedRun(t *testing.T) {
	f := dockerTests(t)[0]
	if f.Problem.Slug != "level-spreads" {
		t.Fatal("fixture order changed")
	}
	cases := f.Problem.SampleCases()[:1]
	tests := []struct {
		source  string
		verdict execution.Verdict
	}{{"class Solution:\n def levelSpreads(self, root): return [123]", execution.WrongAnswer}, {"this is ! syntax", execution.SyntaxError}, {"class Solution:\n def levelSpreads(self, root): raise Exception('hidden')", execution.RuntimeError}, {"class Solution:\n def levelSpreads(self, root):\n  while True: pass", execution.TimeLimit}, {"class Solution:\n def levelSpreads(self, root): print('a'*70000); return []", execution.OutputLimit}, {"class Solution:\n def levelSpreads(self, root): return [2147483648]", execution.InvalidOutput}, {"class Solution:\n def levelSpreads(self, root): a=[]; a.append(a); return a", execution.InvalidOutput}, {"class Solution:\n def levelSpreads(self, root): a=bytearray(1024*1024*1024); return []", execution.MemoryLimit}}
	for _, test := range tests {
		t.Run(string(test.verdict), func(t *testing.T) {
			result := executeFixture(t, f, test.source, "run", cases)
			if result.Verdict != test.verdict {
				t.Fatal(result)
			}
		})
	}
	custom := []worker.Case{{Args: []json.RawMessage{json.RawMessage("[1,2,3]")}}}
	result := executeFixture(t, f, f.ReferenceSource, "run", custom)
	if result.Verdict != "" || result.PublicCaseResults[0].Status != "executed" {
		t.Fatal(result)
	}
}
func TestDockerIsolationFreshStateAndHiddenRedaction(t *testing.T) {
	fixtures := dockerTests(t)
	var f worker.Fixture
	for _, candidate := range fixtures {
		if candidate.Problem.Slug == "run-widths" {
			f = candidate
		}
	}
	source := `import os,socket
class Solution:
 calls = 0
 def runWidths(self, values):
  assert self.calls == 0
  self.calls += 1
  assert 'DATABASE_URL' not in os.environ
  assert not os.path.exists('/Users/engai')
  try:
   open('/etc/quorem-probe','w').write('x')
   raise AssertionError('root writable')
  except OSError: pass
  try:
   socket.create_connection(('1.1.1.1',443),timeout=.1)
   raise AssertionError('network enabled')
  except OSError: pass
  print('hidden marker',values)
  result=[]
  for i,v in enumerate(values):
   if i==0 or v!=values[i-1]: result.append(1)
   else: result[-1]+=1
  return result
`
	result := executeFixture(t, f, source, "submit", f.HiddenCases)
	data, _ := json.Marshal(result)
	if result.Verdict != execution.Accepted || result.Score.Passed != 20 || len(result.PublicCaseResults) > 0 || len(result.SafeDiagnostics) > 0 {
		t.Fatalf("isolation/freshness/redaction failed %s", data)
	}
}
func TestDockerIncorrectCorpusAndCompletePartialScore(t *testing.T) {
	fixtures := dockerTests(t)
	for _, f := range fixtures {
		t.Run(f.Problem.Slug, func(t *testing.T) {
			value := "None"
			switch f.Problem.Signature.ReturnType {
			case "list<int>":
				value = "[]"
			case "str":
				value = "''"
			case "int":
				value = "0"
			}
			source := "class Solution:\n def " + f.Problem.Signature.MethodName + "(self, *args): return " + value
			result := executeFixture(t, f, source, "submit", f.HiddenCases)
			if result.Verdict == execution.Accepted || result.Score == nil || result.Score.Total != 20 || result.Score.Passed >= 20 {
				t.Fatal(result)
			}
		})
	}
	var f worker.Fixture
	for _, candidate := range fixtures {
		if candidate.Problem.Slug == "run-widths" {
			f = candidate
		}
	}
	source := f.ReferenceSource + "\nclass Solution:\n def runWidths(self, values):\n  if not values: raise Exception('secret')\n  return solve(values)\n"
	result := executeFixture(t, f, source, "submit", f.HiddenCases)
	if result.Verdict != execution.RuntimeError || result.Score.Passed != 19 || result.Score.Total != 20 {
		t.Fatal(result)
	}
}
func TestDockerCancellationTearsDown(t *testing.T) {
	f := dockerTests(t)[0]
	ctx, cancel := context.WithCancel(context.Background())
	docker := &Docker{Image: "quorem-python:local", Resolve: func(context.Context, execution.Job) (worker.Spec, error) {
		return worker.Spec{Source: "class Solution:\n def levelSpreads(self, root):\n  while True: pass", Kind: "run", Fixture: f, Cases: f.Problem.SampleCases()[:1]}, nil
	}}
	attempt := "cancel-" + time.Now().Format("150405.000000000")
	job := execution.Job{SubmissionID: "cancel", AttemptID: attempt, RuntimeRevision: execution.RuntimeRevision, HarnessRevision: execution.HarnessRevision, Limits: execution.DefaultLimits()}
	go func() { time.Sleep(300 * time.Millisecond); cancel() }()
	if _, err := docker.Execute(ctx, job); err == nil {
		t.Fatal("cancellation ignored")
	}
	if err := exec.Command("docker", "inspect", "quorem-"+attempt+"-0").Run(); err == nil {
		t.Fatal("cancelled container survived")
	}
}
func TestDockerForgedProtocolIsContestantFailure(t *testing.T) {
	f := dockerTests(t)[0]
	for _, frame := range []string{`{"status":"accepted","actual":[]}`, `{"status":"executed","actual":[]}garbage`} {
		source := "import os\nos.write(1," + strconv.Quote(frame) + ".encode())\nos._exit(0)"
		result := executeFixture(t, f, source, "run", f.Problem.SampleCases()[:1])
		if result.Verdict != execution.InvalidOutput || result.EngineFailure != "" {
			t.Fatal(result)
		}
	}
}
func TestDockerReapsAbandonedAttempt(t *testing.T) {
	dockerTests(t)
	attempt := "abandoned-" + time.Now().Format("150405.000000000")
	name := "quorem-" + attempt + "-0"
	if err := exec.Command("docker", "run", "-d", "--name", name, "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", "268435456", "--pids-limit", "16", "--entrypoint", "python", "quorem-python:local", "-c", "while True: pass").Run(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { exec.Command("docker", "rm", "-f", name).Run() })
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := (&Docker{}).TeardownAttempt(ctx, attempt); err != nil {
		t.Fatal(err)
	}
	if exec.Command("docker", "inspect", name).Run() == nil {
		t.Fatal("abandoned sandbox survived")
	}
}

func TestDockerRuntimeTracebackPublicAndHidden(t *testing.T) {
	f := dockerTests(t)[0]
	source := "class Solution:\n def levelSpreads(self, root):\n  raise ValueError('debug-marker')"
	run := executeFixture(t, f, source, "run", f.Problem.SampleCases()[:1])
	if run.Verdict != execution.RuntimeError || len(run.PublicCaseResults) != 1 {
		t.Fatal(run)
	}
	diagnostics := run.PublicCaseResults[0].Diagnostics
	if len(diagnostics) != 1 || !strings.Contains(diagnostics[0].Message, "ValueError: debug-marker") || !strings.Contains(diagnostics[0].Message, "<solution>") {
		t.Fatal("missing user traceback", diagnostics)
	}
	submit := executeFixture(t, f, source, "submit", f.HiddenCases)
	encoded, _ := json.Marshal(submit)
	if submit.Verdict != execution.RuntimeError || submit.Score == nil || submit.Score.Passed != 0 || submit.Score.Total != 20 || strings.Contains(string(encoded), "debug-marker") || strings.Contains(string(encoded), "Traceback") {
		t.Fatal("hidden traceback leaked", string(encoded))
	}
}
func TestDockerExceptionFormattingBudgets(t *testing.T) {
	f := dockerTests(t)[0]
	for _, test := range []struct {
		body string
		want execution.Verdict
	}{
		{"return 'x'*100000", execution.OutputLimit},
		{"print('x'*100000); return 'message'", execution.OutputLimit},
		{"while True: pass", execution.TimeLimit},
	} {
		source := "class Hostile(Exception):\n def __str__(self):\n  " + test.body + "\nclass Solution:\n def levelSpreads(self, root): raise Hostile()"
		result := executeFixture(t, f, source, "run", f.Problem.SampleCases()[:1])
		if result.Verdict != test.want {
			t.Fatal(result)
		}
		for _, diagnostic := range result.PublicCaseResults[0].Diagnostics {
			if len(diagnostic.Message) > 65536 {
				t.Fatal("unbounded diagnostic")
			}
		}
	}
}
