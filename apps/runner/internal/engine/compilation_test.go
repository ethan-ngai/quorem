package engine

import (
	"context"
	"github.com/ethan-ngai/quorem/apps/api/worker"
	"github.com/ethan-ngai/quorem/internal/execution"
	"io"
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
	engine := &Docker{client: client, compilationLimit: 120 * time.Millisecond, Resolve: func(context.Context, execution.Job) (worker.Spec, error) {
		return worker.Spec{Kind: "submit", Fixture: f, Cases: f.HiddenCases}, nil
	}}
	result, err := engine.Execute(context.Background(), execution.Job{Language: "java", RuntimeRevision: runtime.Revision, HarnessRevision: runtime.Harness, Limits: execution.DefaultLimits()})
	if err != nil || result.Verdict != execution.TimeLimit || result.Score == nil || result.Score.Passed != 1 || result.Score.Total != 3 || len(result.HiddenCases) != 3 {
		t.Fatal(result, err)
	}
}
