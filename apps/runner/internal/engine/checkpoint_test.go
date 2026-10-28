package engine

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/worker"
	"github.com/ethan-ngai/quorem/internal/execution"
)

func TestCheckpointedScoringMatchesUninterrupted(t *testing.T) {
	var calls atomic.Int32
	client, _ := fakeEngine(t, func(_ []byte, w io.Writer) {
		calls.Add(1)
		dockerFrame(w, 1, []byte{0})
		dockerFrame(w, 1, []byte(`{"status":"executed","actual":1,"stdout":"private"}`))
	})
	cases := []worker.Case{{Expected: json.RawMessage(`1`)}, {Expected: json.RawMessage(`2`)}}
	spec := worker.Spec{Kind: "submit", PrivateDetails: true, Cases: cases, SubmitSamples: []worker.Case{{Expected: json.RawMessage(`1`)}}}
	spec.Problem.Signature.ReturnType = "int"
	engine := &Docker{client: client, Resolve: func(context.Context, execution.Job) (worker.Spec, error) { return spec, nil }}
	job := execution.Job{SubmissionID: "submission", AttemptID: "attempt", RuntimeRevision: execution.RuntimeRevision, HarnessRevision: execution.HarnessRevision, Limits: execution.DefaultLimits()}
	want, err := engine.Execute(context.Background(), job)
	if err != nil {
		t.Fatal(err)
	}
	var checkpoint execution.Checkpoint
	var frames []json.RawMessage
	var replays int
	engine.LoadCheckpoint = func(context.Context, execution.Job) (execution.Checkpoint, error) {
		checkpoint.NextOrdinal = len(frames)
		return checkpoint, nil
	}
	engine.ReplayCheckpoint = func(_ context.Context, _ execution.Job, count int, consume func(int, json.RawMessage) error) error {
		replays++
		if count != len(frames) {
			return errors.New("wrong frame count")
		}
		for i, raw := range frames {
			if err := consume(i, raw); err != nil {
				return err
			}
		}
		return nil
	}
	engine.SaveCheckpoint = func(_ context.Context, _ execution.Job, c execution.CheckpointCase) error {
		if c.Ordinal != len(frames) {
			t.Fatal("invalid ordinal", c.Ordinal)
		}
		frames = append(frames, c.Frame)
		if len(c.Artifact) > 0 {
			checkpoint.Artifact = c.Artifact
		}
		checkpoint.CompilationNanos = c.CompilationNanos
		checkpoint.Fatal = c.Fatal
		time.Sleep(50 * time.Millisecond)
		return nil
	}
	var got execution.Completion
	for i := 0; i < 3; i++ {
		ctx, cancel := context.WithTimeout(context.Background(), engine.caseCheckpointReserve(job)+30*time.Millisecond)
		got, err = engine.Execute(ctx, job)
		cancel()
		if i < 2 && !errors.Is(err, worker.ErrYield) {
			t.Fatalf("case %d did not yield: %v", i, err)
		}
		if i == 2 && err != nil {
			t.Fatal(err)
		}
	}
	if len(frames) != 3 || calls.Load() != 6 || replays != 1 || !reflect.DeepEqual(got, want) {
		t.Fatalf("resumed=%+v original=%+v calls=%d", got, want, calls.Load())
	}
}

func TestCheckpointPreservesCompiledArtifactAcrossYield(t *testing.T) {
	var compiles atomic.Int32
	client, _ := fakeEngine(t, func(input []byte, w io.Writer) {
		var request map[string]json.RawMessage
		if err := json.Unmarshal(input, &request); err != nil {
			t.Error(err)
			return
		}
		result := frame{Status: "executed", Actual: json.RawMessage(`1`)}
		if string(request["operation"]) == `"compile-execute"` {
			compiles.Add(1)
			result.Artifact = json.RawMessage(`{"version":1,"language":"typescript","files":{"main.js":"AA=="}}`)
		}
		data, _ := json.Marshal(result)
		dockerFrame(w, 1, []byte{0, 0})
		dockerFrame(w, 1, data)
	})
	cases := []worker.Case{{Expected: json.RawMessage(`1`)}, {Expected: json.RawMessage(`1`)}}
	spec := worker.Spec{Kind: "submit", Cases: cases}
	spec.Problem.Signature.ReturnType = "int"
	runtime, _ := execution.LanguageRuntime("typescript")
	engine := &Docker{client: client, Resolve: func(context.Context, execution.Job) (worker.Spec, error) { return spec, nil }}
	var checkpoint execution.Checkpoint
	var frames []json.RawMessage
	engine.LoadCheckpoint = func(context.Context, execution.Job) (execution.Checkpoint, error) {
		checkpoint.NextOrdinal = len(frames)
		return checkpoint, nil
	}
	engine.ReplayCheckpoint = func(_ context.Context, _ execution.Job, count int, consume func(int, json.RawMessage) error) error {
		if count != len(frames) {
			return errors.New("wrong frame count")
		}
		for i, raw := range frames {
			if err := consume(i, raw); err != nil {
				return err
			}
		}
		return nil
	}
	engine.SaveCheckpoint = func(_ context.Context, _ execution.Job, c execution.CheckpointCase) error {
		frames = append(frames, c.Frame)
		if len(c.Artifact) > 0 {
			checkpoint.Artifact = c.Artifact
		}
		checkpoint.CompilationNanos = c.CompilationNanos
		checkpoint.Fatal = c.Fatal
		time.Sleep(50 * time.Millisecond)
		return nil
	}
	job := execution.Job{Language: "typescript", RuntimeRevision: runtime.Revision, HarnessRevision: runtime.Harness, Limits: execution.DefaultLimits()}
	ctx, cancel := context.WithTimeout(context.Background(), engine.caseCheckpointReserve(job)+30*time.Millisecond)
	_, err := engine.Execute(ctx, job)
	cancel()
	if !errors.Is(err, worker.ErrYield) || len(checkpoint.Artifact) == 0 {
		t.Fatal(err, checkpoint)
	}
	ctx, cancel = context.WithTimeout(context.Background(), engine.caseCheckpointReserve(job)+30*time.Millisecond)
	got, err := engine.Execute(ctx, job)
	cancel()
	if err != nil || got.Verdict != execution.Accepted || got.Score == nil || got.Score.Passed != 2 || compiles.Load() != 1 {
		t.Fatal(got, err, compiles.Load())
	}
}

func TestCheckpointDoesNotStartCaseWithoutEnoughTime(t *testing.T) {
	var calls atomic.Int32
	client, _ := fakeEngine(t, func(_ []byte, w io.Writer) {
		calls.Add(1)
		dockerFrame(w, 1, []byte{0})
		dockerFrame(w, 1, []byte(`{"status":"executed","actual":1}`))
	})
	spec := worker.Spec{Kind: "run", Cases: []worker.Case{{Expected: json.RawMessage(`1`)}}}
	spec.Problem.Signature.ReturnType = "int"
	engine := &Docker{client: client, Resolve: func(context.Context, execution.Job) (worker.Spec, error) { return spec, nil }, LoadCheckpoint: func(context.Context, execution.Job) (execution.Checkpoint, error) { return execution.Checkpoint{}, nil }, ReplayCheckpoint: func(context.Context, execution.Job, int, func(int, json.RawMessage) error) error { return nil }, SaveCheckpoint: func(context.Context, execution.Job, execution.CheckpointCase) error { return nil }}
	job := execution.Job{RuntimeRevision: execution.RuntimeRevision, HarnessRevision: execution.HarnessRevision, Limits: execution.DefaultLimits()}
	ctx, cancel := context.WithTimeout(context.Background(), engine.caseCheckpointReserve(job)-time.Second)
	defer cancel()
	_, err := engine.Execute(ctx, job)
	if err == nil || errors.Is(err, worker.ErrYield) || calls.Load() != 0 {
		t.Fatalf("error=%v case calls=%d", err, calls.Load())
	}
}

func TestCheckpointRestoresFatalSyntaxWithoutRerunningCases(t *testing.T) {
	var calls atomic.Int32
	client, _ := fakeEngine(t, func(_ []byte, w io.Writer) {
		calls.Add(1)
		dockerFrame(w, 1, []byte{0})
		dockerFrame(w, 1, []byte(`{"status":"syntax_error","stderr":"syntax marker","line":2}`))
	})
	cases := []worker.Case{{Expected: json.RawMessage(`1`)}, {Expected: json.RawMessage(`2`)}}
	spec := worker.Spec{Kind: "submit", PrivateDetails: true, SubmitCasesAreSamples: true, Cases: cases, SubmitSamples: cases}
	spec.Problem.Signature.ReturnType = "int"
	engine := &Docker{client: client, Resolve: func(context.Context, execution.Job) (worker.Spec, error) { return spec, nil }}
	job := execution.Job{SubmissionID: "submission", AttemptID: "attempt", RuntimeRevision: execution.RuntimeRevision, HarnessRevision: execution.HarnessRevision, Limits: execution.DefaultLimits()}
	want, err := engine.Execute(context.Background(), job)
	if err != nil {
		t.Fatal(err)
	}
	var checkpoint execution.Checkpoint
	var frames []json.RawMessage
	engine.LoadCheckpoint = func(context.Context, execution.Job) (execution.Checkpoint, error) {
		checkpoint.NextOrdinal = len(frames)
		return checkpoint, nil
	}
	engine.ReplayCheckpoint = func(_ context.Context, _ execution.Job, count int, consume func(int, json.RawMessage) error) error {
		if count != len(frames) {
			return errors.New("wrong frame count")
		}
		for i, raw := range frames {
			if err := consume(i, raw); err != nil {
				return err
			}
		}
		return nil
	}
	fail := true
	engine.SaveCheckpoint = func(_ context.Context, _ execution.Job, c execution.CheckpointCase) error {
		if c.Ordinal == 1 && fail {
			fail = false
			return errors.New("interrupted save")
		}
		frames = append(frames, c.Frame)
		if len(c.Artifact) > 0 {
			checkpoint.Artifact = c.Artifact
		}
		checkpoint.CompilationNanos = c.CompilationNanos
		checkpoint.Fatal = c.Fatal
		return nil
	}
	if _, err = engine.Execute(context.Background(), job); err == nil {
		t.Fatal("save failure ignored")
	}
	if len(frames) != 1 || len(checkpoint.Fatal) == 0 {
		t.Fatal("missing fatal checkpoint", checkpoint)
	}
	got, err := engine.Execute(context.Background(), job)
	if err != nil || !reflect.DeepEqual(got, want) || calls.Load() != 2 {
		t.Fatalf("got=%+v want=%+v calls=%d err=%v", got, want, calls.Load(), err)
	}
}

func TestDockerCheckpointResumesPrivateSubmit(t *testing.T) {
	fixtures := dockerTests(t)
	var fixture worker.Fixture
	for _, f := range fixtures {
		if f.Problem.Slug == "run-widths" {
			fixture = f
		}
	}
	spec := worker.Spec{Kind: "submit", Source: fixture.ReferenceSource, Problem: fixture.Problem, Cases: fixture.HiddenCases[:2], SubmitSamples: fixture.Problem.SampleCases(), PrivateDetails: true}
	engine := &Docker{Image: "quorem-python:local", Resolve: func(context.Context, execution.Job) (worker.Spec, error) { return spec, nil }}
	job := execution.Job{SubmissionID: "checkpoint-docker", AttemptID: "checkpoint-docker-attempt", RuntimeRevision: execution.RuntimeRevision, HarnessRevision: execution.HarnessRevision, Limits: execution.DefaultLimits()}
	want, err := engine.Execute(context.Background(), job)
	if err != nil {
		t.Fatal(err)
	}
	var checkpoint execution.Checkpoint
	var frames []json.RawMessage
	engine.LoadCheckpoint = func(context.Context, execution.Job) (execution.Checkpoint, error) {
		checkpoint.NextOrdinal = len(frames)
		return checkpoint, nil
	}
	engine.ReplayCheckpoint = func(_ context.Context, _ execution.Job, count int, consume func(int, json.RawMessage) error) error {
		if count != len(frames) {
			return errors.New("wrong frame count")
		}
		for i, raw := range frames {
			if err := consume(i, raw); err != nil {
				return err
			}
		}
		return nil
	}
	first := true
	engine.SaveCheckpoint = func(_ context.Context, _ execution.Job, c execution.CheckpointCase) error {
		frames = append(frames, c.Frame)
		if len(c.Artifact) > 0 {
			checkpoint.Artifact = c.Artifact
		}
		checkpoint.CompilationNanos = c.CompilationNanos
		checkpoint.Fatal = c.Fatal
		if first {
			first = false
			time.Sleep(1200 * time.Millisecond)
		}
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), engine.caseCheckpointReserve(job)+time.Second)
	_, err = engine.Execute(ctx, job)
	cancel()
	if !errors.Is(err, worker.ErrYield) || len(frames) != 1 {
		t.Fatal("expected a safe yield", checkpoint, err)
	}
	got, err := engine.Execute(context.Background(), job)
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("resumed=%+v uninterrupted=%+v err=%v", got, want, err)
	}
}

func TestDockerCheckpointResumesCompiledArtifact(t *testing.T) {
	fixture := dockerTests(t)[0]
	fixture.Problem.Signature.ClassName = "Solution"
	fixture.Problem.Signature.MethodName = "solve"
	fixture.Problem.Signature.Parameters = []worker.Parameter{{Name: "n", Type: "int"}}
	fixture.Problem.Signature.ReturnType = "int"
	cases := []worker.Case{{Args: []json.RawMessage{json.RawMessage(`1`)}, Expected: json.RawMessage(`2`)}, {Args: []json.RawMessage{json.RawMessage(`2`)}, Expected: json.RawMessage(`3`)}}
	spec := worker.Spec{Kind: "submit", Source: `class Solution { solve(n:number):number { return n+1; } }`, Problem: fixture.Problem, Cases: cases}
	runtime, _ := execution.LanguageRuntime("typescript")
	engine := &Docker{Resolve: func(context.Context, execution.Job) (worker.Spec, error) { return spec, nil }}
	job := execution.Job{SubmissionID: "compiled-checkpoint", AttemptID: "compiled-checkpoint-attempt", Language: "typescript", RuntimeRevision: runtime.Revision, HarnessRevision: runtime.Harness, Limits: execution.DefaultLimits()}
	var checkpoint execution.Checkpoint
	var frames []json.RawMessage
	engine.LoadCheckpoint = func(context.Context, execution.Job) (execution.Checkpoint, error) {
		checkpoint.NextOrdinal = len(frames)
		return checkpoint, nil
	}
	engine.ReplayCheckpoint = func(_ context.Context, _ execution.Job, count int, consume func(int, json.RawMessage) error) error {
		if count != len(frames) {
			return errors.New("wrong frame count")
		}
		for i, raw := range frames {
			if err := consume(i, raw); err != nil {
				return err
			}
		}
		return nil
	}
	engine.SaveCheckpoint = func(_ context.Context, _ execution.Job, c execution.CheckpointCase) error {
		frames = append(frames, c.Frame)
		if len(c.Artifact) > 0 {
			checkpoint.Artifact = c.Artifact
		}
		checkpoint.CompilationNanos = c.CompilationNanos
		checkpoint.Fatal = c.Fatal
		if c.Ordinal == 0 {
			time.Sleep(1200 * time.Millisecond)
		}
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), engine.caseCheckpointReserve(job)+time.Second)
	_, err := engine.Execute(ctx, job)
	cancel()
	if !errors.Is(err, worker.ErrYield) || len(frames) != 1 || len(checkpoint.Artifact) == 0 {
		t.Fatal("expected compiled checkpoint", checkpoint, err)
	}
	got, err := engine.Execute(context.Background(), job)
	if err != nil || got.Verdict != execution.Accepted || got.Score == nil || got.Score.Passed != 2 {
		t.Fatalf("compiled resume: %+v %v", got, err)
	}
}

func TestDockerCheckpointPreservesHiddenNUL(t *testing.T) {
	fixtures := dockerTests(t)
	var fixture worker.Fixture
	for _, f := range fixtures {
		if f.Problem.Slug == "run-widths" {
			fixture = f
		}
	}
	spec := worker.Spec{Kind: "submit", Source: "class Solution:\n def runWidths(self, values):\n  import sys\n  print('\\0')\n  sys.stderr.write('\\0')\n  return []\n", Problem: fixture.Problem, Cases: fixture.HiddenCases[:2]}
	engine := &Docker{Image: "quorem-python:local", Resolve: func(context.Context, execution.Job) (worker.Spec, error) { return spec, nil }}
	job := execution.Job{SubmissionID: "nul-checkpoint", AttemptID: "nul-checkpoint-attempt", RuntimeRevision: execution.RuntimeRevision, HarnessRevision: execution.HarnessRevision, Limits: execution.DefaultLimits()}
	want, err := engine.Execute(context.Background(), job)
	if err != nil {
		t.Fatal(err)
	}
	var checkpoint execution.Checkpoint
	var frames []json.RawMessage
	engine.LoadCheckpoint = func(context.Context, execution.Job) (execution.Checkpoint, error) {
		checkpoint.NextOrdinal = len(frames)
		return checkpoint, nil
	}
	engine.ReplayCheckpoint = func(_ context.Context, _ execution.Job, count int, consume func(int, json.RawMessage) error) error {
		if count != len(frames) {
			return errors.New("wrong frame count")
		}
		for i, raw := range frames {
			if err := consume(i, raw); err != nil {
				return err
			}
		}
		return nil
	}
	engine.SaveCheckpoint = func(_ context.Context, _ execution.Job, c execution.CheckpointCase) error {
		frames = append(frames, c.Frame)
		if c.Ordinal == 0 {
			time.Sleep(1200 * time.Millisecond)
		}
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), engine.caseCheckpointReserve(job)+time.Second)
	_, err = engine.Execute(ctx, job)
	cancel()
	if !errors.Is(err, worker.ErrYield) || len(frames) != 1 || strings.Contains(string(frames[0]), `\u0000`) {
		t.Fatal("hidden output persisted", checkpoint, err)
	}
	got, err := engine.Execute(context.Background(), job)
	if err != nil || !reflect.DeepEqual(got, want) || len(got.PrivateCaseResults) != 0 {
		t.Fatalf("hidden NUL resume: %+v %v", got, err)
	}
}

func TestPostgresCheckpointResumeMatchesUninterrupted(t *testing.T) {
	image := postgresTestImage(t)
	var fixture worker.Fixture
	if err := json.Unmarshal([]byte(`{"problem":{"sql":{"dialect":"postgresql","outputOrder":"unordered"}}}`), &fixture); err != nil {
		t.Fatal(err)
	}
	var sample, private worker.Case
	if err := json.Unmarshal([]byte(`{"args":[{"tables":[{"name":"items","columns":[{"name":"id","type":"text"}],"rows":[["1"]]}]}],"expected":{"columns":["id"],"rows":[[1]]}}`), &sample); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(`{"args":[{"tables":[{"name":"items","columns":[{"name":"id","type":"text"}],"rows":[["private-error-marker"]]}]}],"expected":{"columns":["id"],"rows":[[1]]}}`), &private); err != nil {
		t.Fatal(err)
	}
	spec := worker.Spec{Kind: "submit", Source: "SELECT id::integer AS id FROM items", Problem: fixture.Problem, Cases: []worker.Case{private}, SubmitSamples: []worker.Case{sample}, PrivateDetails: true}
	runtime, _ := execution.LanguageRuntime("postgresql")
	engine := &Docker{Images: map[string]string{"postgresql": image}, Resolve: func(context.Context, execution.Job) (worker.Spec, error) { return spec, nil }}
	limits := execution.DefaultLimits()
	limits.WallTimeMS = 10000
	job := execution.Job{SubmissionID: "sql-checkpoint", AttemptID: "sql-checkpoint-attempt", Language: "postgresql", RuntimeRevision: runtime.Revision, HarnessRevision: runtime.Harness, Limits: limits}
	want, err := engine.Execute(context.Background(), job)
	if err != nil {
		t.Fatal(err)
	}
	var checkpoint execution.Checkpoint
	var frames []json.RawMessage
	engine.LoadCheckpoint = func(context.Context, execution.Job) (execution.Checkpoint, error) {
		checkpoint.NextOrdinal = len(frames)
		return checkpoint, nil
	}
	engine.ReplayCheckpoint = func(_ context.Context, _ execution.Job, count int, consume func(int, json.RawMessage) error) error {
		if count != len(frames) {
			return errors.New("wrong frame count")
		}
		for i, raw := range frames {
			if err := consume(i, raw); err != nil {
				return err
			}
		}
		return nil
	}
	engine.SaveCheckpoint = func(_ context.Context, _ execution.Job, c execution.CheckpointCase) error {
		frames = append(frames, c.Frame)
		if c.Ordinal == 0 {
			time.Sleep(1200 * time.Millisecond)
		}
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), engine.caseCheckpointReserve(job)+time.Second)
	_, err = engine.Execute(ctx, job)
	cancel()
	if !errors.Is(err, worker.ErrYield) || len(frames) != 1 {
		t.Fatal("expected SQL yield", checkpoint, err)
	}
	got, err := engine.Execute(context.Background(), job)
	if err != nil || !reflect.DeepEqual(got, want) || got.Verdict != execution.RuntimeError || len(got.PrivateCaseResults) != 1 || len(got.PrivateCaseResults[0].Diagnostics) == 0 || len(got.SubmitSampleResults) != 1 || len(got.SubmitSampleResults[0].SQLTypes) != 1 {
		t.Fatalf("SQL resume=%+v baseline=%+v err=%v", got, want, err)
	}
}

type shiftingDeadline struct {
	context.Context
	deadline time.Time
}

func (c *shiftingDeadline) Deadline() (time.Time, bool) { return c.deadline, true }

func TestCheckpointYieldsBeforeFinalReplayWhenTimeIsShort(t *testing.T) {
	client, _ := fakeEngine(t, func(_ []byte, w io.Writer) {
		dockerFrame(w, 1, []byte{0})
		dockerFrame(w, 1, []byte(`{"status":"executed","actual":1}`))
	})
	spec := worker.Spec{Kind: "submit", Cases: []worker.Case{{Expected: json.RawMessage(`1`)}}}
	spec.Problem.Signature.ReturnType = "int"
	engine := &Docker{client: client, Resolve: func(context.Context, execution.Job) (worker.Spec, error) { return spec, nil }}
	job := execution.Job{SubmissionID: "final-yield", AttemptID: "attempt", RuntimeRevision: execution.RuntimeRevision, HarnessRevision: execution.HarnessRevision, Limits: execution.DefaultLimits()}
	var frames []json.RawMessage
	engine.LoadCheckpoint = func(context.Context, execution.Job) (execution.Checkpoint, error) {
		return execution.Checkpoint{NextOrdinal: len(frames)}, nil
	}
	engine.ReplayCheckpoint = func(_ context.Context, _ execution.Job, count int, consume func(int, json.RawMessage) error) error {
		if count != len(frames) {
			return errors.New("wrong frame count")
		}
		for i, raw := range frames {
			if err := consume(i, raw); err != nil {
				return err
			}
		}
		return nil
	}
	ctx := &shiftingDeadline{Context: context.Background(), deadline: time.Now().Add(2 * time.Minute)}
	engine.SaveCheckpoint = func(_ context.Context, _ execution.Job, c execution.CheckpointCase) error {
		frames = append(frames, c.Frame)
		ctx.deadline = time.Now().Add(time.Second)
		return nil
	}
	_, err := engine.Execute(ctx, job)
	if !errors.Is(err, worker.ErrYield) || len(frames) != 1 {
		t.Fatal("final replay did not yield", err)
	}
	got, err := engine.Execute(context.Background(), job)
	if err != nil || got.Verdict != execution.Accepted || got.Score == nil || got.Score.Passed != 1 {
		t.Fatal(got, err)
	}
}
