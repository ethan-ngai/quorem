package problems

import (
	"encoding/json"
	"testing"
)

func TestNormalizeQuestionDraftNestedCases(t *testing.T) {
	content := QuestionContent{
		Problem: Problem{
			Examples: []ProblemExample{{Case: Case{Calls: []MethodCall{{MethodName: "noop"}}}}},
			Odyssey: &Odyssey{Levels: []OdysseyLevel{{
				Methods:  []Signature{{MethodName: "noop"}},
				Examples: []ProblemExample{{Case: Case{Calls: []MethodCall{{MethodName: "noop"}}}}},
			}}},
		},
		HiddenCases:        []Case{{Calls: []MethodCall{{MethodName: "noop"}}}},
		OdysseyHiddenCases: [][]Case{{{Calls: []MethodCall{{MethodName: "noop"}}}}, nil},
	}
	content = NormalizeQuestionDraft(content)
	check := func(c Case) {
		t.Helper()
		if c.Args == nil || c.Calls[0].Args == nil || c.Calls[0].Expected != nil {
			t.Fatalf("case shape: %+v", c)
		}
		data, err := json.Marshal(c)
		if err != nil || string(data) != `{"calls":[{"methodName":"noop","args":[]}],"args":[]}` {
			t.Fatalf("case JSON: %s %v", data, err)
		}
	}
	check(content.Problem.Examples[0].Case)
	check(content.HiddenCases[0])
	check(content.Problem.Odyssey.Levels[0].Examples[0].Case)
	check(content.OdysseyHiddenCases[0][0])
	if content.Problem.Odyssey.Levels[0].Methods[0].Parameters == nil || content.OdysseyHiddenCases[1] == nil {
		t.Fatal("nested arrays were not normalized")
	}
}

func TestQuestionDefinitionSharesValidationWithoutPrivateReferences(t *testing.T) {
	fixtures, err := LoadFixtures("../../../../fixtures/problems")
	if err != nil {
		t.Fatal(err)
	}
	f := fixtures[0]
	content := QuestionContent{Problem: f.Problem, Attribution: f.Attribution}
	if err = ValidateQuestionDefinition(content, false); err != nil {
		t.Fatal(err)
	}
	if err = ValidateQuestionPublication(content); err == nil {
		t.Fatal("published question accepted without private cases")
	}
	content.HiddenCases = []Case{{}}
	if err = ValidateQuestionDefinition(content, false); err == nil {
		t.Fatal("invalid private case accepted")
	}
}
