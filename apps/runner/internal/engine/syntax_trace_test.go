package engine

import (
	"context"
	"io"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/worker"
	"github.com/ethan-ngai/quorem/internal/execution"
)

func TestSyntaxTraceReachesEveryPublicCase(t *testing.T) {
	client, _ := fakeEngine(t, func(_ []byte, writer io.Writer) {
		dockerFrame(writer, 1, []byte{0})
		dockerFrame(writer, 1, []byte(`{"status":"syntax_error","line":4,"stderr":"SyntaxError: expected ':'"}`))
	})
	runtime, _ := execution.LanguageRuntime("python")
	engine := &Docker{client: client, Resolve: func(context.Context, execution.Job) (worker.Spec, error) {
		return worker.Spec{Kind: "submit", Cases: []worker.Case{{}}, SubmitSamples: []worker.Case{{}, {}}}, nil
	}}
	result, err := engine.Execute(context.Background(), execution.Job{Language: "python", RuntimeRevision: runtime.Revision, HarnessRevision: runtime.Harness, Limits: execution.DefaultLimits()})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.SubmitSampleResults) != 2 {
		t.Fatal(result)
	}
	for _, sample := range result.SubmitSampleResults {
		if sample.Stderr != "SyntaxError: expected ':'" || len(sample.Diagnostics) != 1 || sample.Diagnostics[0].Line != 4 {
			t.Fatalf("missing compiler trace: %+v", sample)
		}
	}
}
