package engine

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/worker"
	"github.com/ethan-ngai/quorem/internal/execution"
)

// Emulates the Worker's framed transport while executing the actual case image.
func TestRemoteSandboxPreflightWithDocker(t *testing.T) {
	if os.Getenv("QUOREM_TEST_DIRECT_DOCKER") != "1" {
		t.Skip("enable direct sandbox integration")
	}
	if err := exec.Command("docker", "image", "inspect", "quorem-case-python:local").Run(); err != nil {
		t.Fatal("quorem-case-python:local image required")
	}
	var mu sync.Mutex
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempt := strings.TrimPrefix(r.URL.Path, "/internal/case/")
		if !caseAttempt.MatchString(attempt) {
			w.WriteHeader(400)
			return
		}
		name := "quorem-direct-test-" + attempt
		if r.Method == "DELETE" {
			_ = exec.Command("docker", "rm", "-f", name).Run()
			if exec.Command("docker", "inspect", name).Run() == nil {
				w.WriteHeader(503)
				return
			}
			w.WriteHeader(204)
			return
		}
		image := "quorem-case-" + r.Header.Get("X-Case-Language") + ":local"
		cmd := exec.Command("docker", "run", "-i", "--rm", "--name", name, "--privileged", "--user", "0:0", "--cgroupns=private", "--network=none", "--entrypoint", "python3", image, "/opt/quorem/launcher.py", r.Header.Get("X-Case-Language"), r.Header.Get("X-Case-Memory"), r.Header.Get("X-Case-Processes"))
		cmd.Stdin = r.Body
		out, err := cmd.StdoutPipe()
		if err != nil {
			w.WriteHeader(503)
			return
		}
		stderr, err := cmd.StderrPipe()
		if err != nil {
			w.WriteHeader(503)
			return
		}
		if err := cmd.Start(); err != nil {
			w.WriteHeader(503)
			return
		}
		send := func(channel byte, b []byte) {
			mu.Lock()
			defer mu.Unlock()
			_, _ = w.Write(testCaseFrame(channel, b))
			w.(http.Flusher).Flush()
		}
		var wg sync.WaitGroup
		pump := func(channel byte, input io.Reader) {
			defer wg.Done()
			b := make([]byte, 32768)
			for {
				n, err := input.Read(b)
				if n > 0 {
					send(channel, b[:n])
				}
				if err != nil {
					return
				}
			}
		}
		wg.Add(2)
		go pump(1, out)
		go pump(2, stderr)
		wg.Wait()
		err = cmd.Wait()
		code := 0
		if err != nil {
			var exit *exec.ExitError
			if !errors.As(err, &exit) {
				return
			}
			code = exit.ExitCode()
		}
		b := make([]byte, 4)
		binary.BigEndian.PutUint32(b, uint32(code))
		send(3, b)
		send(4, nil)
	}))
	defer server.Close()
	remote, err := NewRemoteSandbox(server.URL, "test-control-token-at-least-32-characters")
	if err != nil {
		t.Fatal(err)
	}
	verifyRemoteSandbox(t, remote)
}

func verifyRemoteSandbox(t *testing.T, remote *RemoteSandbox) {
	t.Helper()
	started := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	if err := (&Docker{Remote: remote}).VerifySandbox(ctx); err != nil {
		logHostedCasePhase(t, remote, err)
		t.Fatal(fmt.Errorf("remote preflight: %w", err))
	}
	t.Logf("general isolation preflight: %s", time.Since(started))
	if err := (&Docker{Remote: remote}).VerifyPostgresSandbox(ctx); err != nil {
		logHostedCasePhase(t, remote, err)
		t.Fatal(fmt.Errorf("remote PostgreSQL preflight: %w", err))
	}
	fixture := worker.Fixture{}
	fixture.Problem.Signature.ClassName = "Solution"
	fixture.Problem.Signature.MethodName = "solve"
	fixture.Problem.Signature.Parameters = []worker.Parameter{{Name: "value", Type: "int"}}
	fixture.Problem.Signature.ReturnType = "int"
	cases := []worker.Case{{Args: []json.RawMessage{json.RawMessage(`1`)}, Expected: json.RawMessage(`2`)}, {Args: []json.RawMessage{json.RawMessage(`2`)}, Expected: json.RawMessage(`3`)}}
	for _, tc := range []struct{ language, source string }{
		{"python", "import os\nclass Solution:\n def solve(self, value):\n  if os.path.exists('/tmp/prior-case'): return -1\n  open('/tmp/prior-case','w').write('x')\n  return value + 1"},
		{"java", "class Solution { public int solve(int value) { return value + 1; } }"},
		{"typescript", "class Solution { solve(value:number):number { return value + 1; } }"},
		{"ocaml", "let solve value = value + 1"},
	} {
		started := time.Now()
		runtime, ok := execution.LanguageRuntime(tc.language)
		if !ok {
			t.Fatal("missing language runtime")
		}
		runner := &Docker{Remote: remote, Resolve: func(context.Context, execution.Job) (worker.Spec, error) {
			return worker.Spec{Source: tc.source, Kind: "run", Problem: fixture.Problem, Cases: cases}, nil
		}}
		result, err := runner.Execute(ctx, execution.Job{Language: tc.language, AttemptID: "direct-" + tc.language, SubmissionID: "test", RuntimeRevision: runtime.Revision, HarnessRevision: runtime.Harness, Limits: execution.DefaultLimits()})
		if err != nil || result.Verdict != execution.Accepted {
			if err != nil {
				logHostedCasePhase(t, remote, fmt.Errorf("attempt direct-%s: %w", tc.language, err))
			}
			t.Fatalf("%s: %+v %v", tc.language, result, err)
		}
		t.Logf("%s two cases: %s", tc.language, time.Since(started))
	}
	runtime, _ := execution.LanguageRuntime("python")
	runner := &Docker{Remote: remote, Resolve: func(context.Context, execution.Job) (worker.Spec, error) {
		return worker.Spec{Source: "class Solution:\n def solve(self, value):\n  if value == 1:\n   while True: pass\n  return value + 1", Kind: "run", Problem: fixture.Problem, Cases: cases}, nil
	}}
	limits := execution.DefaultLimits()
	limits.WallTimeMS = 200
	result, err := runner.Execute(ctx, execution.Job{Language: "python", AttemptID: "direct-timeout", SubmissionID: "test", RuntimeRevision: runtime.Revision, HarnessRevision: runtime.Harness, Limits: limits})
	if err != nil || len(result.PublicCaseResults) != 2 || result.PublicCaseResults[0].Status != "time_limit" || result.PublicCaseResults[1].Status != "accepted" {
		t.Fatalf("timeout must not suppress later cases: %+v %v", result, err)
	}
	var odyssey worker.Fixture
	data, err := os.ReadFile("../../../../fixtures/odyssey/balance-ledger.json")
	if err != nil || json.Unmarshal(data, &odyssey) != nil {
		t.Fatal("cannot load Odyssey fixture")
	}
	var content struct {
		Implementations []struct{ Language, ReferenceSource string }
	}
	if err := json.Unmarshal(data, &content); err != nil {
		t.Fatal(err)
	}
	odysseyCases := append(append([]worker.Case{}, odyssey.OdysseyHiddenCases[0]...), odyssey.OdysseyHiddenCases[1]...)
	for _, impl := range content.Implementations {
		started := time.Now()
		runtime, ok := execution.LanguageRuntime(impl.Language)
		if !ok {
			t.Fatal("missing Odyssey runtime")
		}
		runner := &Docker{Remote: remote, Resolve: func(context.Context, execution.Job) (worker.Spec, error) {
			return worker.Spec{Source: impl.ReferenceSource, Kind: "submit", Problem: odyssey.Problem, Cases: odysseyCases}, nil
		}}
		result, err := runner.Execute(ctx, execution.Job{Language: impl.Language, AttemptID: "odyssey-" + impl.Language, SubmissionID: "test", RuntimeRevision: runtime.Revision, HarnessRevision: runtime.Harness, Limits: execution.DefaultLimits()})
		if err != nil || result.Verdict != execution.Accepted || result.Score == nil || result.Score.Passed != 4 {
			if err != nil {
				logHostedCasePhase(t, remote, fmt.Errorf("attempt odyssey-%s: %w", impl.Language, err))
			}
			t.Fatalf("Odyssey %s: %+v %v", impl.Language, result, err)
		}
		t.Logf("%s Odyssey four cases: %s", impl.Language, time.Since(started))
	}
}

func logHostedCasePhase(t *testing.T, remote *RemoteSandbox, probeErr error) {
	if os.Getenv("QUOREM_TEST_DIRECT_ORIGIN") == "" {
		return
	}
	match := regexp.MustCompile(`attempt ([A-Za-z0-9-]+)`).FindStringSubmatch(probeErr.Error())
	if len(match) != 2 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, err := remote.request(ctx, match[1], http.MethodGet, nil)
	if err != nil {
		return
	}
	res, err := remote.client.Do(req)
	if err != nil {
		t.Log("case diagnostics unavailable")
		return
	}
	defer res.Body.Close()
	var status struct{ Phase, Failure, Source string }
	if res.StatusCode == http.StatusOK && json.NewDecoder(io.LimitReader(res.Body, 256)).Decode(&status) == nil {
		for label, phase := range map[string]string{"lifecycle": status.Phase, "failure": status.Failure, "source": status.Source} {
			switch phase {
			case "none", "idle", "admitted", "started", "exec-begin", "exec-ready", "streams-complete", "stop-begin", "destroy-begin", "destroy-complete", "stop-complete", "setup", "streams", "input", "stdout", "stderr", "exit", "exit-frame", "destroy", "terminal-frame", "close":
				t.Logf("case %s: %s", label, phase)
			}
		}
	}
}

func TestRemoteSandboxHosted(t *testing.T) {
	origin := os.Getenv("QUOREM_TEST_DIRECT_ORIGIN")
	if origin == "" {
		t.Skip("hosted case sandbox not configured")
	}
	remote, err := NewRemoteSandbox(origin, os.Getenv("QUOREM_TEST_DIRECT_TOKEN"))
	if err != nil {
		t.Fatal("invalid hosted sandbox configuration")
	}
	verifyRemoteSandbox(t, remote)
}
