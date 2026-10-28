package problems

import (
	"encoding/json"
	"testing"
)

func TestCaseCompareSharesSQLTypesAndExpectedSemantics(t *testing.T) {
	p := Problem{QuestionDefinition: QuestionDefinition{SQL: &SQLConfig{OutputOrder: "ordered", Output: []SQLColumn{{Name: "id", Type: "integer"}}}}}
	codec := NewCaseCodec(p)
	c := Case{Expected: json.RawMessage(`{"columns":["id"],"rows":[[1]]}`)}
	for _, tc := range []struct {
		name     string
		actual   string
		types    []string
		status   string
		mismatch bool
	}{
		{"match", `{"columns":["id"],"rows":[[1]]}`, []string{"integer"}, "accepted", false},
		{"wrong type", `{"columns":["id"],"rows":[[1]]}`, []string{"bigint"}, "wrong_answer", true},
		{"wrong value", `{"columns":["id"],"rows":[[2]]}`, []string{"integer"}, "wrong_answer", false},
		{"invalid result", `[]`, []string{"integer"}, "invalid_output", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status, _, _, mismatch, err := codec.Compare(c, "executed", json.RawMessage(tc.actual), tc.types)
			if err != nil || status != tc.status || mismatch != tc.mismatch {
				t.Fatalf("%s %v %v", status, mismatch, err)
			}
		})
	}
}
