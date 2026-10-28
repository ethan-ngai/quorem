package engine

import (
	"github.com/ethan-ngai/quorem/apps/api/worker"
	"github.com/ethan-ngai/quorem/internal/execution"
)

type caseAccumulator struct {
	spec        worker.Spec
	codec       *worker.CaseCodec
	result      execution.Completion
	language    string
	passed      int
	allCompared bool
}

func newCaseAccumulator(spec worker.Spec, language string, result execution.Completion) *caseAccumulator {
	return &caseAccumulator{spec: spec, codec: worker.NewCaseCodec(spec.Problem), result: result, language: language, allCompared: true}
}

func (a *caseAccumulator) add(i int, c worker.Case, f frame) error {
	sample := i >= len(a.spec.Cases)
	status, actual, expected, typeMismatch, err := a.codec.Compare(c, f.Status, f.Actual, f.SQLTypes)
	if err != nil {
		return err
	}
	if !sample {
		if f.Status == "executed" && status == "accepted" {
			a.passed++
		}
		if status == "executed" {
			a.allCompared = false
		}
	}
	if !sample && status != "accepted" && status != "executed" && a.result.Verdict == "" {
		a.result.Verdict = execution.Verdict(status)
	}
	if a.spec.Kind == "submit" && !sample {
		hiddenStatus := execution.WrongAnswer
		if status == "accepted" || status == "time_limit" {
			hiddenStatus = execution.Verdict(status)
		}
		a.result.HiddenCases = append(a.result.HiddenCases, execution.HiddenCaseResult{Index: i, Status: hiddenStatus})
	}
	if a.spec.Kind == "run" || a.spec.PrivateDetails || sample {
		public := execution.PublicCaseResult{Index: i, Status: status, Actual: actual, Expected: expected}
		if len(actual) > 0 && a.spec.Problem.SQL != nil {
			public.SQLTypes = f.SQLTypes
		}
		if typeMismatch {
			public.Diagnostics = append(public.Diagnostics, execution.Diagnostic{Message: "Output column types do not match the SQL schema."})
		}
		if a.language == "postgresql" && status != "executed" && status != "accepted" && f.Stderr != "" {
			public.Diagnostics = append(public.Diagnostics, execution.Diagnostic{Message: f.Stderr, Line: f.Line})
		} else {
			if f.Line > 0 {
				public.Diagnostics = append(public.Diagnostics, execution.Diagnostic{Message: "Syntax error", Line: f.Line})
			}
			public.Stderr = f.Stderr
		}
		if a.language == "postgresql" && status == "invalid_output" && f.Stderr == "" {
			public.Diagnostics = append(public.Diagnostics, execution.Diagnostic{Message: "The query returned an invalid or unsupported result."})
		}
		public.Stdout = f.Stdout
		if sample {
			public.Index = i - len(a.spec.Cases)
			a.result.SubmitSampleResults = append(a.result.SubmitSampleResults, public)
		} else if a.spec.Kind == "run" {
			a.result.PublicCaseResults = append(a.result.PublicCaseResults, public)
		} else {
			a.result.PrivateCaseResults = append(a.result.PrivateCaseResults, public)
			if a.spec.SubmitCasesAreSamples {
				a.result.SubmitSampleResults = append(a.result.SubmitSampleResults, public)
			}
		}
	}

	return nil
}

func (a *caseAccumulator) finish() execution.Completion {
	if a.spec.Kind == "submit" {
		a.result.Score = &execution.Score{Passed: a.passed, Total: len(a.spec.Cases)}
	}
	if a.result.Verdict == "" && a.allCompared {
		a.result.Verdict = execution.Accepted
	}
	return a.result
}
