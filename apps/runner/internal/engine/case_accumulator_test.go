package engine

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/worker"
	"github.com/ethan-ngai/quorem/internal/execution"
)

func intCase(expected string) worker.Case {
	c := worker.Case{Args: []json.RawMessage{}}
	if expected != "" {
		c.Expected = json.RawMessage(expected)
	}
	return c
}

func TestCaseAccumulatorRunAndSubmitProjection(t *testing.T) {
	cases := []worker.Case{intCase("1"), intCase("2")}
	spec := worker.Spec{Kind: "submit", Cases: cases, SubmitSamples: []worker.Case{intCase("3")}}
	spec.Problem.Signature.ReturnType = "int"
	a := newCaseAccumulator(spec, "python", execution.Completion{SubmissionID: "submission", AttemptID: "attempt"})
	frames := []frame{{Status: "executed", Actual: json.RawMessage(`9`), Stdout: "private marker"}, {Status: "executed", Actual: json.RawMessage(`2`)}, {Status: "executed", Actual: json.RawMessage(`3`), Stdout: "visible"}}
	for i, c := range append(cases, spec.SubmitSamples...) {
		if err := a.add(i, c, frames[i]); err != nil {
			t.Fatal(err)
		}
	}
	got := a.finish()
	encoded, _ := json.Marshal(got)
	if got.Verdict != execution.WrongAnswer || got.Score == nil || got.Score.Passed != 1 || got.Score.Total != 2 || len(got.HiddenCases) != 2 || got.HiddenCases[0].Status != execution.WrongAnswer || got.HiddenCases[1].Status != execution.Accepted || len(got.SubmitSampleResults) != 1 || got.SubmitSampleResults[0].Index != 0 || got.SubmitSampleResults[0].Stdout != "visible" || strings.Contains(string(encoded), "private marker") {
		t.Fatalf("submit projection: %s", encoded)
	}

	spec.Kind, spec.Cases, spec.SubmitSamples = "run", []worker.Case{intCase("")}, nil
	a = newCaseAccumulator(spec, "python", execution.Completion{})
	if err := a.add(0, spec.Cases[0], frame{Status: "executed", Actual: json.RawMessage(`3`)}); err != nil {
		t.Fatal(err)
	}
	run := a.finish()
	if run.Verdict != "" || len(run.PublicCaseResults) != 1 || run.PublicCaseResults[0].Status != "executed" || run.Score != nil {
		t.Fatalf("uncompared run: %+v", run)
	}
}

func TestCaseAccumulatorPublicFallbackAndSyntax(t *testing.T) {
	cases := []worker.Case{intCase("1"), intCase("2")}
	spec := worker.Spec{Kind: "submit", PrivateDetails: true, SubmitCasesAreSamples: true, Cases: cases, SubmitSamples: cases}
	spec.Problem.Signature.ReturnType = "int"
	a := newCaseAccumulator(spec, "python", execution.Completion{})
	for i, c := range cases {
		if err := a.add(i, c, frame{Status: "syntax_error", Stderr: "bad syntax", Line: 2}); err != nil {
			t.Fatal(err)
		}
	}
	got := a.finish()
	if got.Verdict != execution.SyntaxError || got.Score == nil || got.Score.Passed != 0 || got.Score.Total != 2 || !reflect.DeepEqual(got.PrivateCaseResults, got.SubmitSampleResults) || got.PrivateCaseResults[1].Index != 1 || got.PrivateCaseResults[1].Diagnostics[0].Line != 2 {
		t.Fatalf("fallback syntax: %+v", got)
	}
}

func TestCaseAccumulatorSQLValidationAndDiagnostics(t *testing.T) {
	c := worker.Case{Args: []json.RawMessage{json.RawMessage(`{"tables":[]}`)}, Expected: json.RawMessage(`{"rows":[[1]]}`)}
	spec := worker.Spec{Kind: "run", Cases: []worker.Case{c}}
	spec.Problem.SQL = &worker.SQLConfig{}
	if err := json.Unmarshal([]byte(`{"dialect":"postgresql","outputOrder":"ordered","output":[{"name":"n","type":"integer"}]}`), spec.Problem.SQL); err != nil {
		t.Fatal(err)
	}
	a := newCaseAccumulator(spec, "postgresql", execution.Completion{})
	if err := a.add(0, c, frame{Status: "executed", Actual: json.RawMessage(`{"rows":[[1]]}`), SQLTypes: []string{"bigint"}}); err != nil {
		t.Fatal(err)
	}
	got := a.finish()
	if got.Verdict != execution.WrongAnswer || len(got.PublicCaseResults) != 1 || len(got.PublicCaseResults[0].Diagnostics) != 1 || !strings.Contains(got.PublicCaseResults[0].Diagnostics[0].Message, "types") {
		t.Fatalf("type mismatch: %+v", got)
	}
	a = newCaseAccumulator(spec, "postgresql", execution.Completion{})
	if err := a.add(0, c, frame{Status: "invalid_output"}); err != nil {
		t.Fatal(err)
	}
	got = a.finish()
	if got.Verdict != execution.InvalidOutput || len(got.PublicCaseResults[0].Diagnostics) != 1 || got.PublicCaseResults[0].Diagnostics[0].Message != "The query returned an invalid or unsupported result." {
		t.Fatalf("invalid SQL output: %+v", got)
	}
}
