package postgres

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ethan-ngai/quorem/internal/execution"
)

func TestHiddenCaseValidationAndRedaction(t *testing.T) {
	valid := execution.Completion{Score: &execution.Score{Passed: 1, Total: 2}, HiddenCases: []execution.HiddenCaseResult{{Index: 0, Status: execution.Accepted}, {Index: 1, Status: execution.WrongAnswer}}}
	if err := validateHiddenCases(valid); err != nil {
		t.Fatal(err)
	}
	for _, completion := range []execution.Completion{
		{HiddenCases: valid.HiddenCases},
		{Score: valid.Score, HiddenCases: []execution.HiddenCaseResult{}},
		{Score: valid.Score, HiddenCases: []execution.HiddenCaseResult{{Index: 0, Status: execution.Accepted}, {Index: 0, Status: execution.WrongAnswer}}},
		{Score: valid.Score, HiddenCases: []execution.HiddenCaseResult{{Index: 0, Status: execution.Accepted}, {Index: 1, Status: "hidden-marker"}}},
		{Score: valid.Score, HiddenCases: []execution.HiddenCaseResult{{Index: 0, Status: execution.Accepted}, {Index: 1, Status: execution.RuntimeError}}},
		{Score: valid.Score, HiddenCases: []execution.HiddenCaseResult{{Index: 0, Status: execution.Accepted}, {Index: 1, Status: execution.Accepted}}},
	} {
		if validateHiddenCases(completion) == nil {
			t.Fatal("invalid hidden completion accepted", completion)
		}
	}
	var hidden execution.HiddenCaseResult
	if err := json.Unmarshal([]byte(`{"index":0,"status":"accepted","actual":"hidden-marker","expected":"hidden-marker","stdout":"hidden-marker","stderr":"hidden-marker","diagnostics":[{"message":"hidden-marker"}]}`), &hidden); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(hidden)
	if err != nil || strings.Contains(string(data), "hidden-marker") || string(data) != `{"index":0,"status":"accepted"}` {
		t.Fatal("hidden values leaked", string(data), err)
	}
}

func TestSubmissionVerdictMatchesScore(t *testing.T) {
	for _, tc := range []struct {
		name     string
		verdict  execution.Verdict
		score    *execution.Score
		admitted int
		valid    bool
	}{
		{"accepted", execution.Accepted, &execution.Score{Passed: 2, Total: 2}, 2, true},
		{"partial", execution.RuntimeError, &execution.Score{Passed: 1, Total: 2}, 2, true},
		{"accepted partial", execution.Accepted, &execution.Score{Passed: 1, Total: 2}, 2, false},
		{"failed perfect", execution.WrongAnswer, &execution.Score{Passed: 2, Total: 2}, 2, false},
		{"unknown", execution.Verdict("unknown"), &execution.Score{Passed: 1, Total: 2}, 2, false},
		{"empty", execution.Accepted, &execution.Score{}, 0, false},
		{"missing score", execution.Accepted, nil, 2, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := validateSubmitCompletion(execution.Completion{Verdict: tc.verdict, Score: tc.score}, tc.admitted)
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v: %v", tc.valid, err)
			}
		})
	}
}
