package engine

import (
	"context"
	"encoding/json"
	"io"
	"reflect"
	"sync/atomic"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/worker"
	"github.com/ethan-ngai/quorem/internal/execution"
)

func TestSubmitPublicFallbackExecutesSamplesOnce(t *testing.T) {
	for _, fallback := range []bool{false, true} {
		t.Run(map[bool]string{false: "private suite", true: "public fallback"}[fallback], func(t *testing.T) {
			var calls atomic.Int32
			client, _ := fakeEngine(t, func(_ []byte, output io.Writer) {
				calls.Add(1)
				dockerFrame(output, 1, []byte{0})
				dockerFrame(output, 1, []byte(`{"status":"executed","actual":1,"stdout":"shown","stderr":"note"}`))
			})
			cases := []worker.Case{{Args: []json.RawMessage{}, Expected: json.RawMessage(`1`)}, {Args: []json.RawMessage{}, Expected: json.RawMessage(`2`)}}
			spec := worker.Spec{Kind: "submit", PrivateDetails: true, SubmitCasesAreSamples: fallback, Cases: cases, SubmitSamples: cases}
			spec.Problem.Signature.ReturnType = "int"
			engine := &Docker{client: client, Resolve: func(context.Context, execution.Job) (worker.Spec, error) { return spec, nil }}
			job := execution.Job{RuntimeRevision: execution.RuntimeRevision, HarnessRevision: execution.HarnessRevision, Limits: execution.DefaultLimits()}
			result, err := engine.Execute(context.Background(), job)
			expectedCalls := int32(4)
			if fallback {
				expectedCalls = 2
			}
			if err != nil || calls.Load() != expectedCalls || result.Score == nil || result.Score.Passed != 1 || result.Score.Total != 2 || result.Verdict != execution.WrongAnswer || len(result.PrivateCaseResults) != 2 || len(result.SubmitSampleResults) != 2 {
				t.Fatalf("calls=%d result=%+v err=%v", calls.Load(), result, err)
			}
			for i, sample := range result.SubmitSampleResults {
				if sample.Index != i || sample.Stdout != "shown" || sample.Stderr != "note" || !reflect.DeepEqual(sample, result.PrivateCaseResults[i]) {
					t.Fatalf("sample %d differs: %+v %+v", i, sample, result.PrivateCaseResults[i])
				}
			}
		})
	}
}

func TestPublicFallbackPreservesSyntaxFailures(t *testing.T) {
	var calls atomic.Int32
	client, _ := fakeEngine(t, func(_ []byte, output io.Writer) {
		calls.Add(1)
		dockerFrame(output, 1, []byte{0})
		dockerFrame(output, 1, []byte(`{"status":"syntax_error","stderr":"syntax marker","line":2}`))
	})
	cases := []worker.Case{{Args: []json.RawMessage{}, Expected: json.RawMessage(`1`)}, {Args: []json.RawMessage{}, Expected: json.RawMessage(`2`)}}
	spec := worker.Spec{Kind: "submit", PrivateDetails: true, SubmitCasesAreSamples: true, Cases: cases, SubmitSamples: cases}
	spec.Problem.Signature.ReturnType = "int"
	engine := &Docker{client: client, Resolve: func(context.Context, execution.Job) (worker.Spec, error) { return spec, nil }}
	result, err := engine.Execute(context.Background(), execution.Job{RuntimeRevision: execution.RuntimeRevision, HarnessRevision: execution.HarnessRevision, Limits: execution.DefaultLimits()})
	if err != nil || calls.Load() != 1 || result.Verdict != execution.SyntaxError || result.Score == nil || result.Score.Total != 2 || result.Score.Passed != 0 || len(result.SubmitSampleResults) != 2 || !reflect.DeepEqual(result.PrivateCaseResults, result.SubmitSampleResults) {
		t.Fatal(result, err, calls.Load())
	}
	for _, r := range result.SubmitSampleResults {
		if r.Status != "syntax_error" || r.Stderr != "syntax marker" || len(r.Diagnostics) != 1 || r.Diagnostics[0].Line != 2 {
			t.Fatal(r)
		}
	}
}
