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
