package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/ethan-ngai/quorem/apps/api/worker"
	"github.com/ethan-ngai/quorem/internal/execution"
	"io"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Docker struct {
	Image   string
	Resolve func(context.Context, execution.Job) (worker.Spec, error)
}
type frame struct {
	Status string          `json:"status"`
	Actual json.RawMessage `json:"actual"`
	Stdout string          `json:"stdout"`
	Stderr string          `json:"stderr"`
	Line   int             `json:"line"`
}
type bounded struct {
	mu       sync.Mutex
	buffer   bytes.Buffer
	limit    int
	exceeded bool
	cancel   context.CancelFunc
}

// The trusted harness emits one readiness byte before any contestant code can run.
type sandboxOutput struct {
	*bounded
	ready bool
	start func()
}

func (o *sandboxOutput) Write(p []byte) (int, error) {
	consumed := 0
	if !o.ready && len(p) > 0 {
		if p[0] != 0 {
			return 0, errors.New("missing sandbox readiness marker")
		}
		o.ready = true
		o.start()
		p = p[1:]
		consumed = 1
	}
	n, err := o.bounded.Write(p)
	return n + consumed, err
}

func (b *bounded) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.buffer.Len()+len(p) > b.limit {
		b.exceeded = true
		b.cancel()
		return len(p), nil
	}
	return b.buffer.Write(p)
}
func (d *Docker) Execute(ctx context.Context, j execution.Job) (execution.Completion, error) {
	result := execution.Completion{SubmissionID: j.SubmissionID, AttemptID: j.AttemptID}
	if j.RuntimeRevision != execution.RuntimeRevision || j.HarnessRevision != execution.HarnessRevision {
		return result, errors.New("unsupported execution revision")
	}
	spec, err := d.Resolve(ctx, j)
	if err != nil {
		return result, err
	}
	passed := 0
	allCompared := true
	for i, c := range spec.Cases {
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		f, err := d.runCase(ctx, j, i, spec, c)
		if err != nil {
			return result, err
		}
		status := f.Status
		var actual, expected json.RawMessage
		if status == "executed" {
			actual, err = worker.Normalize(spec.Fixture.Problem.Signature.ReturnType, f.Actual)
			if err != nil {
				status = "invalid_output"
			} else if len(c.Expected) > 0 {
				expected, err = worker.Normalize(spec.Fixture.Problem.Signature.ReturnType, c.Expected)
				if err != nil {
					return result, errors.New("invalid trusted expectation")
				}
				if bytes.Equal(actual, expected) {
					status = "accepted"
					passed++
				} else {
					status = "wrong_answer"
				}
			} else {
				allCompared = false
			}
		}
		if status != "accepted" && status != "executed" && result.Verdict == "" {
			result.Verdict = execution.Verdict(status)
		}
		if spec.Kind == "submit" {
			hiddenStatus := execution.WrongAnswer
			if status == "accepted" || status == "time_limit" {
				hiddenStatus = execution.Verdict(status)
			}
			result.HiddenCases = append(result.HiddenCases, execution.HiddenCaseResult{Index: i, Status: hiddenStatus})
		}
		if spec.Kind == "run" {
			public := execution.PublicCaseResult{Index: i, Status: status, Actual: actual, Expected: expected}
			if f.Line > 0 {
				public.Diagnostics = append(public.Diagnostics, execution.Diagnostic{Message: "Syntax error", Line: f.Line})
			}
			public.Stdout = f.Stdout
			public.Stderr = f.Stderr
			result.PublicCaseResults = append(result.PublicCaseResults, public)
		}
	}
	if spec.Kind == "submit" {
		result.Score = &execution.Score{Passed: passed, Total: len(spec.Cases)}
	}
	if result.Verdict == "" && allCompared {
		result.Verdict = execution.Accepted
	}
	return result, nil
}
func (d *Docker) runCase(parent context.Context, j execution.Job, index int, spec worker.Spec, c worker.Case) (frame, error) {
	ctx, cancelCause := context.WithCancelCause(parent)
	cancel := func() { cancelCause(context.Canceled) }
	defer cancel()
	startupFailure := errors.New("sandbox startup timed out")
	caseTimeout := errors.New("contestant wall time exceeded")
	startup := time.AfterFunc(10*time.Second, func() { cancelCause(startupFailure) })
	defer startup.Stop()
	var deadline *time.Timer
	name := "quorem-" + j.AttemptID + "-" + strconv.Itoa(index)
	request, _ := json.Marshal(map[string]any{"source": spec.Source, "signature": spec.Fixture.Problem.Signature, "args": c.Args})
	args := []string{"run", "--rm", "-i", "--name", name, "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--memory", strconv.FormatInt(j.Limits.MemoryBytes, 10), "--memory-swap", strconv.FormatInt(j.Limits.MemoryBytes, 10), "--pids-limit", strconv.Itoa(j.Limits.MaxProcesses), "--cpus", "1", "--user", "65534:65534", "--tmpfs", "/tmp:rw,noexec,nosuid,size=16777216", d.Image}
	cmd := exec.CommandContext(ctx, "docker", args...)
	cmd.Stdin = bytes.NewReader(request)
	out := &sandboxOutput{bounded: &bounded{limit: j.Limits.OutputBytes*6 + 1024, cancel: cancel}, start: func() {
		startup.Stop()
		deadline = time.AfterFunc(time.Duration(j.Limits.WallTimeMS)*time.Millisecond, func() { cancelCause(caseTimeout) })
	}}
	stderr := &bounded{limit: j.Limits.OutputBytes, cancel: cancel}
	cmd.Stdout = out
	cmd.Stderr = stderr
	err := cmd.Run()
	startup.Stop()
	if deadline != nil {
		deadline.Stop()
	}
	// Killing the Docker client alone leaves containers running.
	cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cleanupCancel()
	if cleanupErr := removeContainer(cleanupCtx, name); cleanupErr != nil {
		return frame{}, worker.ErrTeardown
	}

	if parent.Err() != nil {
		return frame{}, parent.Err()
	}
	if out.exceeded || stderr.exceeded {
		return frame{Status: "output_limit"}, nil
	}
	if errors.Is(context.Cause(ctx), startupFailure) {
		return frame{}, startupFailure
	}
	if errors.Is(context.Cause(ctx), caseTimeout) {
		return frame{Status: "time_limit"}, nil
	}
	if !out.ready {
		return frame{}, errors.New("sandbox failed before harness readiness")
	}
	if err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			switch exit.ExitCode() {
			case 137:
				return frame{Status: "memory_limit"}, nil
			case 125, 126, 127:
				return frame{}, errors.New("sandbox startup failed")
			default:
				return frame{Status: "runtime_error"}, nil
			}
		}
		return frame{}, err
	}
	var f frame
	decoder := json.NewDecoder(bytes.NewReader(out.buffer.Bytes()))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&f); err != nil {
		return frame{Status: "invalid_output"}, nil
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return frame{Status: "invalid_output"}, nil
	}
	switch f.Status {
	case "executed", "syntax_error", "runtime_error", "memory_limit", "output_limit", "invalid_output":
	default:
		return frame{Status: "invalid_output"}, nil
	}
	if len(f.Stdout) > j.Limits.OutputBytes || len(f.Stderr) > j.Limits.OutputBytes || len(f.Actual) > j.Limits.OutputBytes {
		return frame{Status: "output_limit"}, nil
	}
	return f, nil
}

func removeContainer(ctx context.Context, name string) error {
	if exec.CommandContext(ctx, "docker", "rm", "-f", name).Run() == nil {
		return nil
	}
	remaining, err := exec.CommandContext(ctx, "docker", "ps", "-a", "--filter", "name=^/"+regexp.QuoteMeta(name)+"$", "--format", "{{.ID}}").Output()
	if err != nil || strings.TrimSpace(string(remaining)) != "" {
		return worker.ErrTeardown
	}
	return nil
}
func (d *Docker) TeardownAttempt(ctx context.Context, attempt string) error {
	containers, err := exec.CommandContext(ctx, "docker", "ps", "-a", "--filter", "name=^/quorem-"+regexp.QuoteMeta(attempt)+"-", "--format", "{{.Names}}").Output()
	if err != nil {
		return worker.ErrTeardown
	}
	for _, name := range strings.Fields(string(containers)) {
		if err = removeContainer(ctx, name); err != nil {
			return err
		}
	}
	return nil
}
