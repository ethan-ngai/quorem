package problems

import (
	"encoding/json"
	"testing"
)

func TestNormalizeQuestionDraftNestedCases(t *testing.T) {
	content := QuestionContent{
		Problem: QuestionDefinition{Examples: []ProblemExample{{Case: Case{Calls: []MethodCall{{MethodName: "noop"}}}}}, Odyssey: &Odyssey{Levels: []OdysseyLevel{{
			Methods:  []Signature{{MethodName: "noop"}},
			Examples: []ProblemExample{{Case: Case{Calls: []MethodCall{{MethodName: "noop"}}}}},
		}}}},
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
	content := QuestionContent{Problem: f.Problem.QuestionDefinition, Attribution: f.Attribution}
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

func TestSignatureValidationAcrossQuestionTypes(t *testing.T) {
	fixtures, err := LoadFixtures("../../../../fixtures/problems")
	if err != nil {
		t.Fatal(err)
	}
	classic := QuestionContent{Problem: fixtures[0].Problem.QuestionDefinition, HiddenCases: fixtures[0].HiddenCases, Attribution: fixtures[0].Attribution}
	for name, mutate := range map[string]func(*Signature){
		"bad method":          func(s *Signature) { s.MethodName = "not-valid" },
		"bad codec":           func(s *Signature) { s.Parameters[0].Type = "unknown" },
		"bad return":          func(s *Signature) { s.ReturnType = "unknown" },
		"duplicate parameter": func(s *Signature) { s.Parameters = append(s.Parameters, s.Parameters[0]) },
	} {
		t.Run(name, func(t *testing.T) {
			ordinary := classic
			ordinary.Problem.Signature.Parameters = append([]Parameter(nil), classic.Problem.Signature.Parameters...)
			mutate(&ordinary.Problem.Signature)
			if ValidateQuestionDefinition(ordinary, true) == nil {
				t.Fatal("classic signature accepted")
			}
			staged := odysseyContent(t)
			mutate(&staged.Problem.Odyssey.Levels[0].Methods[0])
			if ValidateOdyssey(staged) == nil {
				t.Fatal("Odyssey signature accepted")
			}
		})
	}
}

func TestQuestionFixtureUsesAuthoredImplementations(t *testing.T) {
	for _, tc := range []struct {
		name, primary string
		sql           *SQLConfig
	}{
		{name: "coding", primary: "python"},
		{name: "sql", primary: "postgresql", sql: &SQLConfig{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			content := QuestionContent{
				Problem:         QuestionDefinition{SQL: tc.sql},
				Implementations: []AuthoringImplementation{{LanguageImplementation: LanguageImplementation{Language: tc.primary, StarterSource: "starter", RuntimeRevision: "runtime", HarnessRevision: "harness"}, ReferenceSource: "reference"}},
			}
			fixture, err := content.Fixture()
			if err != nil || fixture.Problem.StarterSource != "starter" || fixture.Problem.RuntimeRevision != "runtime" || fixture.HarnessRevision != "harness" || fixture.ReferenceSource != "reference" || len(fixture.Problem.Languages) != 1 || fixture.Problem.Languages[0].Language != tc.primary {
				t.Fatalf("fixture projection: %+v %v", fixture, err)
			}
			content.Implementations = append(content.Implementations, content.Implementations[0])
			if _, err = content.Fixture(); err == nil {
				t.Fatal("duplicate primary implementation accepted")
			}
			content.Implementations = nil
			if _, err = content.Fixture(); err == nil {
				t.Fatal("missing primary implementation accepted")
			}
		})
	}
}

func TestQuestionDefinitionJSONOmitsRuntimeProjection(t *testing.T) {
	fixtures, err := LoadFixtures("../../../../fixtures/problems")
	if err != nil {
		t.Fatal(err)
	}
	f := fixtures[0]
	content := QuestionContent{Problem: f.Problem.QuestionDefinition, Implementations: f.Implementations}
	encoded, err := json.Marshal(content)
	if err != nil {
		t.Fatal(err)
	}
	var raw struct {
		Problem         map[string]json.RawMessage `json:"problem"`
		Implementations []json.RawMessage          `json:"implementations"`
	}
	if err = json.Unmarshal(encoded, &raw); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"starterSource", "runtimeRevision", "languages", "isPrivate", "solutionLanguages", "complexityLanguages"} {
		if _, exists := raw.Problem[key]; exists {
			t.Fatalf("derived field %s in authored definition", key)
		}
	}
	if len(raw.Implementations) != len(f.Implementations) {
		t.Fatal("lost implementations")
	}
}

func TestDraftRejectsNULSourceButAllowsEscapedLiteral(t *testing.T) {
	c := QuestionContent{Implementations: []AuthoringImplementation{{LanguageImplementation: LanguageImplementation{StarterSource: "ok"}, ReferenceSource: "bad\x00source"}}}
	if err := ValidateQuestionDraft(c); err == nil {
		t.Fatal("accepted NUL reference")
	}
	c.Implementations[0].ReferenceSource = `return "\\0"`
	if err := ValidateQuestionDraft(c); err != nil {
		t.Fatal(err)
	}
	c.Solutions = []EditorialSolution{{Source: "bad\x00source"}}
	if err := ValidateQuestionDraft(c); err == nil {
		t.Fatal("accepted NUL editorial")
	}
}
