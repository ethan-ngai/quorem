package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/ethan-ngai/quorem/apps/api/worker"
	"github.com/ethan-ngai/quorem/internal/execution"
	"io"
	"strconv"
	"sync"
	"time"
)

type Docker struct {
	client           *dockerEngine
	Image            string
	Images           map[string]string
	EnsureImage      func(context.Context, string) error
	compilationLimit time.Duration
	Resolve          func(context.Context, execution.Job) (worker.Spec, error)
}

const compilationBudget = 60 * time.Second

type frame struct {
	compilationTime time.Duration
	Status          string          `json:"status"`
	SQLTypes        []string        `json:"sqlTypes,omitempty"`
	Artifact        json.RawMessage `json:"artifact,omitempty"`
	Actual          json.RawMessage `json:"actual"`
	Stdout          string          `json:"stdout"`
	Stderr          string          `json:"stderr"`
	Line            int             `json:"line"`
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
	ready        bool
	initialReady bool
	firstAt      time.Time
	finalAt      time.Time
	markers      int
	expected     int
	onInitial    func()
	start        func()
}

func (o *sandboxOutput) Write(p []byte) (int, error) {
	consumed := 0
	required := o.expected
	if required == 0 {
		required = 1
	}
	for !o.ready && len(p) > 0 {
		if p[0] != 0 {
			return consumed, errors.New("missing sandbox readiness marker")
		}
		if !o.initialReady {
			o.firstAt = time.Now()
			if o.onInitial != nil {
				o.onInitial()
			}
		}
		o.initialReady = true
		o.markers++
		p = p[1:]
		consumed++
		if o.markers == required {
			o.ready = true
			o.finalAt = time.Now()
			o.start()
		}
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
	runtime, supported := execution.RuntimeForRevision(j.RuntimeRevision, j.HarnessRevision)
	if !supported || (j.Language != "" && runtime.Language != j.Language) {
		return result, errors.New("unsupported execution revision")
	}
	if d.EnsureImage != nil {
		if err := d.EnsureImage(ctx, runtime.Language); err != nil {
			return result, err
		}
	}
	spec, err := d.Resolve(ctx, j)
	if err != nil {
		return result, err
	}
	passed := 0
	allCompared := true
	var compilationTime time.Duration
	budget := d.compilationLimit
	if budget <= 0 {
		budget = compilationBudget
	}
	var fatal *frame
	var artifact json.RawMessage
	cases := append([]worker.Case{}, spec.Cases...)
	if spec.Kind == "submit" {
		cases = append(cases, spec.SubmitSamples...)
	}
	for i, c := range cases {
		sample := i >= len(spec.Cases)
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		var f frame
		if fatal != nil {
			f = frame{Status: fatal.Status, Line: fatal.Line, Stderr: fatal.Stderr}
		} else if runtime.Language != "python" && runtime.Language != "postgresql" && len(artifact) == 0 && budget-compilationTime <= time.Millisecond {
			f = frame{Status: "time_limit"}
		} else {
			compiling := runtime.Language != "python" && runtime.Language != "postgresql" && len(artifact) == 0
			if runtime.Language == "python" || runtime.Language == "postgresql" {
				f, err = d.runCase(ctx, j, i, spec, c, budget-compilationTime)
			} else if compiling {
				f, err = d.runRequest(ctx, j, i, compiledFirstCaseRequest(spec, c), compiledArtifactLimit, budget-compilationTime)
			} else {
				f, err = d.runRequest(ctx, j, i, compiledCaseRequest(spec, c, artifact), j.Limits.OutputBytes)
			}
			if err != nil {
				return result, err
			}
			if compiling {
				compilationTime += f.compilationTime
				if len(f.Artifact) > 0 {
					if err = validateCompiledArtifact(f.Artifact, runtime.Language); err != nil {
						return result, err
					}
					artifact = f.Artifact
				}
			}
			if f.Status == "syntax_error" && runtime.Language != "postgresql" {
				fatal = &f
			}
		}
		status := f.Status
		var actual, expected json.RawMessage
		typeMismatch := false
		if status == "executed" {
			actual, err = worker.NormalizeCaseOutput(spec.Fixture, c, f.Actual)
			if err != nil {
				status = "invalid_output"
			} else if len(worker.CaseExpected(spec.Fixture, c)) > 0 {
				typeMismatch = !sqlOutputTypesMatch(spec.Fixture.Problem.SQL, f.SQLTypes)
				expected, err = worker.NormalizeCaseOutput(spec.Fixture, c, worker.CaseExpected(spec.Fixture, c))
				if err != nil {
					return result, errors.New("invalid trusted expectation")
				}
				if bytes.Equal(actual, expected) && !typeMismatch {
					status = "accepted"
					if !sample {
						passed++
					}
				} else {
					status = "wrong_answer"
				}
			} else {
				typeMismatch = !sqlOutputTypesMatch(spec.Fixture.Problem.SQL, f.SQLTypes)
				if typeMismatch {
					status = "wrong_answer"
				} else if !sample {
					allCompared = false
				}
			}
		}
		if !sample && status != "accepted" && status != "executed" && result.Verdict == "" {
			result.Verdict = execution.Verdict(status)
		}
		if spec.Kind == "submit" && !sample {
			hiddenStatus := execution.WrongAnswer
			if status == "accepted" || status == "time_limit" {
				hiddenStatus = execution.Verdict(status)
			}
			result.HiddenCases = append(result.HiddenCases, execution.HiddenCaseResult{Index: i, Status: hiddenStatus})
		}
		if spec.Kind == "run" || spec.PrivateDetails || sample {
			public := execution.PublicCaseResult{Index: i, Status: status, Actual: actual, Expected: expected}
			if len(actual) > 0 && spec.Fixture.Problem.SQL != nil {
				public.SQLTypes = f.SQLTypes
			}
			if typeMismatch {
				public.Diagnostics = append(public.Diagnostics, execution.Diagnostic{Message: "Output column types do not match the SQL schema."})
			}
			if runtime.Language == "postgresql" && status != "executed" && status != "accepted" && f.Stderr != "" {
				public.Diagnostics = append(public.Diagnostics, execution.Diagnostic{Message: f.Stderr, Line: f.Line})
			} else {
				if f.Line > 0 {
					public.Diagnostics = append(public.Diagnostics, execution.Diagnostic{Message: "Syntax error", Line: f.Line})
				}
				public.Stderr = f.Stderr
			}
			if runtime.Language == "postgresql" && status == "invalid_output" && f.Stderr == "" {
				public.Diagnostics = append(public.Diagnostics, execution.Diagnostic{Message: "The query returned an invalid or unsupported result."})
			}
			public.Stdout = f.Stdout
			if sample {
				public.Index = i - len(spec.Cases)
				result.SubmitSampleResults = append(result.SubmitSampleResults, public)
			} else if spec.Kind == "run" {
				result.PublicCaseResults = append(result.PublicCaseResults, public)
			} else {
				result.PrivateCaseResults = append(result.PrivateCaseResults, public)
			}
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
func sqlOutputTypesMatch(schema *worker.SQLConfig, actual []string) bool {
	if schema == nil || len(schema.Output) == 0 {
		return true
	}
	if len(actual) != len(schema.Output) {
		return false
	}
	for i, column := range schema.Output {
		if actual[i] != column.Type {
			return false
		}
	}
	return true
}
func sandboxRequest(spec worker.Spec, c worker.Case) []byte {
	calls := make([]map[string]any, 0, len(c.Calls))
	for _, call := range c.Calls {
		calls = append(calls, map[string]any{"methodName": call.MethodName, "args": call.Args})
	}
	request, _ := json.Marshal(map[string]any{"source": spec.Source, "signature": spec.Fixture.Problem.Signature, "args": c.Args, "calls": calls, "methods": worker.MethodSignatures(spec.Fixture), "sql": spec.Fixture.Problem.SQL})
	return request
}
func (d *Docker) runCase(parent context.Context, j execution.Job, index int, spec worker.Spec, c worker.Case, compilationRemaining ...time.Duration) (result frame, resultErr error) {
	return d.runRequest(parent, j, index, sandboxRequest(spec, c), j.Limits.OutputBytes, compilationRemaining...)
}

func (d *Docker) runRequest(parent context.Context, j execution.Job, index int, request []byte, outputLimit int, compilationRemaining ...time.Duration) (result frame, resultErr error) {
	client, err := d.engine()
	if err != nil {
		return frame{}, err
	}
	ctx, cancelCause := context.WithCancelCause(parent)
	cancel := func() { cancelCause(context.Canceled) }
	defer cancel()
	startupFailure := errors.New("sandbox startup timed out")
	caseTimeout := errors.New("contestant wall time exceeded")
	startupDuration := 10 * time.Second
	if len(compilationRemaining) > 0 && compilationRemaining[0] < startupDuration {
		startupDuration = compilationRemaining[0]
	}
	startup := time.AfterFunc(10*time.Second, func() { cancelCause(startupFailure) })
	defer startup.Stop()
	var deadline *time.Timer
	name := "quorem-" + j.AttemptID + "-" + strconv.Itoa(index)
	runtime, supported := execution.RuntimeForRevision(j.RuntimeRevision, j.HarnessRevision)
	if !supported {
		runtime, _ = execution.LanguageRuntime("python")
	}
	image := runtime.Image
	if configured := d.Images[runtime.Language]; configured != "" {
		image = configured
	}
	if runtime.Language == "python" && d.Image != "" {
		image = d.Image
	}
	markers := 1
	if runtime.Language != "python" && runtime.Language != "postgresql" {
		markers = 2
	}
	out := &sandboxOutput{expected: markers, onInitial: func() {
		if runtime.Language != "python" && runtime.Language != "postgresql" {
			startup.Reset(startupDuration)
		}
	}, bounded: &bounded{limit: outputLimit*6 + 1024, cancel: cancel}, start: func() {
		startup.Stop()
		deadline = time.AfterFunc(time.Duration(j.Limits.WallTimeMS)*time.Millisecond, func() { cancelCause(caseTimeout) })
	}}
	stderr := &bounded{limit: j.Limits.OutputBytes, cancel: cancel}
	defer func() {
		if runtime.Language != "python" && runtime.Language != "postgresql" && out.initialReady {
			if out.ready {
				result.compilationTime = out.finalAt.Sub(out.firstAt)
			} else {
				result.compilationTime = time.Since(out.firstAt)
			}
		}
	}()
	exitCode, err := client.run(ctx, name, image, j.Limits, request, out, stderr, runtime.Language == "postgresql")
	startup.Stop()
	if deadline != nil {
		deadline.Stop()
	}
	// A canceled stream does not stop its container; confirm removal before releasing the slot.
	cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cleanupCancel()
	if cleanupErr := client.remove(cleanupCtx, name); cleanupErr != nil {
		return frame{}, worker.ErrTeardown
	}
	if errors.Is(err, worker.ErrTeardown) {
		return frame{}, worker.ErrTeardown
	}

	if parent.Err() != nil {
		return frame{}, parent.Err()
	}
	if out.exceeded || stderr.exceeded {
		return frame{Status: "output_limit"}, nil
	}
	if errors.Is(context.Cause(ctx), startupFailure) {
		if out.initialReady {
			return frame{Status: "time_limit"}, nil
		}
		return frame{}, startupFailure
	}
	if errors.Is(context.Cause(ctx), caseTimeout) {
		return frame{Status: "time_limit"}, nil
	}
	if !out.ready {
		return frame{}, errors.New("sandbox failed before harness readiness: " + stderr.buffer.String())
	}
	if err != nil {
		return frame{}, err
	}
	if exitCode != 0 {
		if exitCode == 137 {
			return frame{Status: "memory_limit"}, nil
		}
		return frame{Status: "runtime_error"}, nil
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
	actualLimit := j.Limits.OutputBytes
	if index < 0 {
		actualLimit = outputLimit
	}
	if len(f.Stdout) > j.Limits.OutputBytes || len(f.Stderr) > j.Limits.OutputBytes || len(f.Actual) > actualLimit || len(f.Artifact) > compiledArtifactLimit {
		return frame{Status: "output_limit"}, nil
	}
	return f, nil
}

func (d *Docker) TeardownAttempt(ctx context.Context, attempt string) error {
	client, err := d.engine()
	if err != nil {
		return worker.ErrTeardown
	}
	names, err := client.attemptContainers(ctx, attempt)
	if err != nil {
		return worker.ErrTeardown
	}
	for _, name := range names {
		if err = client.remove(ctx, name); err != nil {
			return err
		}
	}
	return nil
}
