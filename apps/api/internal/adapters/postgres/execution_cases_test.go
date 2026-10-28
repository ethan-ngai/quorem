package postgres

import (
	"encoding/json"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
)

func TestExecutionCases(t *testing.T) {
	sample := problems.Case{Args: []json.RawMessage{json.RawMessage(`1`)}, Expected: json.RawMessage(`2`)}
	hidden := problems.Case{Args: []json.RawMessage{json.RawMessage(`3`)}, Expected: json.RawMessage(`4`)}
	custom := problems.Case{Args: []json.RawMessage{json.RawMessage(`5`)}}
	fixture := problems.Fixture{Problem: problems.Problem{Signature: problems.Signature{Parameters: []problems.Parameter{{Name: "x", Type: "int"}}, ReturnType: "int"}, Examples: []problems.ProblemExample{{Case: sample}}}, HiddenCases: []problems.Case{hidden}}
	for _, tc := range []struct {
		name, kind         string
		custom             []problems.Case
		fallback, noHidden bool
		want               string
		invalid            bool
	}{
		{name: "run", kind: "run", want: "1"},
		{name: "submit", kind: "submit", want: "3"},
		{name: "interview fallback", kind: "submit", fallback: true, noHidden: true, want: "1"},
		{name: "custom run", kind: "run", custom: []problems.Case{custom}, want: "5"},
		{name: "custom submit", kind: "submit", custom: []problems.Case{custom}, invalid: true},
		{name: "empty custom", kind: "run", custom: []problems.Case{}, invalid: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := fixture
			if tc.noHidden {
				f.HiddenCases = nil
			}
			cases, err := executionCases(&f, 0, tc.kind, tc.custom, tc.fallback)
			if tc.invalid {
				if errorCode(err) != "invalid_input" {
					t.Fatalf("expected invalid input: %v", err)
				}
				return
			}
			if err != nil || len(cases) != 1 || string(cases[0].Args[0]) != tc.want {
				t.Fatalf("cases=%v err=%v", cases, err)
			}
		})
	}
}
