package engine

import (
	"context"
	"encoding/json"
	"github.com/ethan-ngai/quorem/apps/api/worker"
	"github.com/ethan-ngai/quorem/internal/execution"
	"io"
	"sync/atomic"
	"testing"
	"time"
)

func TestCompilationBudgetProducesContestantVerdict(t *testing.T) {
	client, _ := fakeEngine(t, func(_ []byte, writer io.Writer) {
		dockerFrame(writer, 1, []byte{0})
		time.Sleep(80 * time.Millisecond)
		dockerFrame(writer, 1, []byte{0})
		dockerFrame(writer, 1, []byte(`{"status":"executed","actual":[]}`))
	})
	f := worker.Fixture{}
	f.Problem.Signature.ReturnType = "list<int>"
	f.HiddenCases = []worker.Case{{Expected: []byte("[]")}, {Expected: []byte("[]")}, {Expected: []byte("[]")}}
	runtime, _ := execution.LanguageRuntime("java")
	engine := &Docker{client: client, compilationLimit: 40 * time.Millisecond, Resolve: func(context.Context, execution.Job) (worker.Spec, error) {
		return worker.Spec{Kind: "submit", Fixture: f, Cases: f.HiddenCases}, nil
	}}
	result, err := engine.Execute(context.Background(), execution.Job{Language: "java", RuntimeRevision: runtime.Revision, HarnessRevision: runtime.Harness, Limits: execution.DefaultLimits()})
	if err != nil || result.Verdict != execution.TimeLimit || result.Score == nil || result.Score.Passed != 0 || result.Score.Total != 3 || len(result.HiddenCases) != 3 {
		t.Fatal(result, err)
	}
}

func TestCompilationIsReusedWithoutCarryingCaseInputs(t *testing.T) {
	var compiles, executes atomic.Int32
	client, _ := fakeEngine(t, func(input []byte, writer io.Writer) {
		var request map[string]json.RawMessage
		if err := json.Unmarshal(input, &request); err != nil {
			t.Error(err)
			return
		}
		result := frame{Status: "executed", Actual: json.RawMessage(`[]`)}
		if string(request["operation"]) == `"compile-execute"` {
			compiles.Add(1)
			result.Artifact = json.RawMessage(`{"version":1,"language":"typescript","files":{"main.js":"AA=="}}`)
		} else {
			executes.Add(1)
			if _, ok := request["source"]; ok {
				t.Error("source recompiled for another case")
			}
			if _, ok := request["artifact"]; !ok {
				t.Error("compiled artifact missing")
			}
		}
		dockerFrame(writer, 1, []byte{0, 0})
		encoded, _ := json.Marshal(result)
		dockerFrame(writer, 1, encoded)
	})
	f := worker.Fixture{}
	f.Problem.Signature.ReturnType = "list<int>"
	cases := []worker.Case{{Expected: []byte(`[]`)}, {Expected: []byte(`[]`)}, {Expected: []byte(`[]`)}}
	runtime, _ := execution.LanguageRuntime("typescript")
	docker := &Docker{client: client, Resolve: func(context.Context, execution.Job) (worker.Spec, error) {
		return worker.Spec{Source: "source", Kind: "submit", Fixture: f, Cases: cases}, nil
	}}
	result, err := docker.Execute(context.Background(), execution.Job{AttemptID: "compile-once", Language: "typescript", RuntimeRevision: runtime.Revision, HarnessRevision: runtime.Harness, Limits: execution.DefaultLimits()})
	if err != nil || result.Verdict != execution.Accepted || compiles.Load() != 1 || executes.Load() != 2 {
		t.Fatalf("result=%+v error=%v compiles=%d executes=%d", result, err, compiles.Load(), executes.Load())
	}
}

func TestFirstCaseTimeoutDoesNotDiscardLaterCases(t *testing.T) {
	var calls atomic.Int32
	client, _ := fakeEngine(t, func(_ []byte, writer io.Writer) {
		call := calls.Add(1)
		dockerFrame(writer, 1, []byte{0, 0})
		if call == 1 {
			time.Sleep(150 * time.Millisecond)
			return
		}
		dockerFrame(writer, 1, []byte(`{"status":"executed","actual":[],"artifact":{"version":1,"language":"typescript","files":{"main.js":"AA=="}}}`))
	})
	f := worker.Fixture{}
	f.Problem.Signature.ReturnType = "list<int>"
	cases := []worker.Case{{Expected: []byte(`[]`)}, {Expected: []byte(`[]`)}}
	runtime, _ := execution.LanguageRuntime("typescript")
	engine := &Docker{client: client, Resolve: func(context.Context, execution.Job) (worker.Spec, error) {
		return worker.Spec{Kind: "submit", Fixture: f, Cases: cases}, nil
	}}
	limits := execution.DefaultLimits()
	limits.WallTimeMS = 50
	result, err := engine.Execute(context.Background(), execution.Job{AttemptID: "first-timeout", Language: "typescript", RuntimeRevision: runtime.Revision, HarnessRevision: runtime.Harness, Limits: limits})
	if err != nil || result.Verdict != execution.TimeLimit || result.Score.Passed != 1 || result.Score.Total != 2 {
		t.Fatalf("partial score lost: %+v %v", result, err)
	}
}
