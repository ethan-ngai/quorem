package problems

import (
	"encoding/json"
	"os"
	"testing"
)

func odysseyContent(t *testing.T) QuestionContent {
	t.Helper()
	data, err := os.ReadFile("../../../../fixtures/odyssey/balance-ledger.json")
	if err != nil {
		t.Fatal(err)
	}
	var c QuestionContent
	if err = json.Unmarshal(data, &c); err != nil {
		t.Fatal(err)
	}
	return c
}
func TestOdysseyPublicationAndCumulativeSuites(t *testing.T) {
	c := odysseyContent(t)
	if err := ValidateQuestionPublication(c); err != nil {
		t.Fatal(err)
	}
	f := Fixture{Problem: c.Problem, OdysseyHiddenCases: c.OdysseyHiddenCases}
	runProblem, samples, err := CompileOdyssey(f, 1, "run")
	if err != nil || len(samples) != len(c.Problem.Odyssey.Levels[0].Examples) || len(runProblem.Odyssey.Levels) != 1 {
		t.Fatal("run includes incorrect levels", samples, err)
	}
	_, samples, err = CompileOdyssey(f, 2, "run")
	if err != nil || len(samples) != len(c.Problem.Odyssey.Levels[0].Examples)+len(c.Problem.Odyssey.Levels[1].Examples) {
		t.Fatal("run omits cumulative examples", samples, err)
	}
	withoutPrivate := Fixture{Problem: c.Problem}
	if _, _, err := CompileOdyssey(withoutPrivate, 1, "run"); err != nil {
		t.Fatal("run requires private suites", err)
	}
	if _, _, err := CompileOdyssey(withoutPrivate, 1, "submit"); err == nil {
		t.Fatal("submit accepted missing private suites")
	}
	if _, _, err := CompileOdyssey(f, 1, "unknown"); err == nil {
		t.Fatal("accepted invalid execution kind")
	}
	p, tests, err := CompileOdyssey(f, 1, "submit")
	if err != nil || len(tests) != 2 || len(p.Odyssey.Levels) != 1 {
		t.Fatal(p, tests, err)
	}
	p, tests, err = CompileOdyssey(f, 2, "submit")
	if err != nil || len(tests) != 4 || len(p.Odyssey.Levels) != 2 {
		t.Fatal(p, tests, err)
	}
	if string(NewCaseCodec(p).Expected(tests[2])) != "[5,true,false,3]" {
		t.Fatal(string(NewCaseCodec(p).Expected(tests[2])))
	}
	if _, _, err = CompileOdyssey(f, 3, "submit"); err == nil {
		t.Fatal("accepted nonexistent level")
	}
	c.OdysseyHiddenCases[0] = append(c.OdysseyHiddenCases[0], tests[2])
	if err = ValidateQuestionPublication(c); err == nil {
		t.Fatal("future method accepted in level one")
	}
}
func TestOdysseyCallValidationAndHeterogeneousResults(t *testing.T) {
	c := odysseyContent(t)
	p := c.Problem
	test := c.OdysseyHiddenCases[1][0]
	if _, err := NewCaseCodec(p).Normalize(test, []byte(`[5,true,false,3]`)); err != nil {
		t.Fatal(err)
	}
	if _, err := NewCaseCodec(p).Normalize(test, []byte(`[5,1,false,3]`)); err == nil {
		t.Fatal("wrong result type accepted")
	}
	test.Calls[0].MethodName = "__getattribute__"
	if err := ValidateProblemCase(p, test, true); err == nil {
		t.Fatal("undeclared method accepted")
	}
}
func TestOdysseyRequiresPrimarySignatureFromFirstStage(t *testing.T) {
	c := odysseyContent(t)
	c.Problem.Signature.MethodName = "different"
	if err := ValidateQuestionPublication(c); err == nil {
		t.Fatal("published primary signature differs from first stage")
	}
}

func TestOdysseyVoidMethods(t *testing.T) {
	p := Problem{Odyssey: &Odyssey{Levels: []OdysseyLevel{{Methods: []Signature{{ClassName: "Solution", MethodName: "clear", ReturnType: "void"}}}}}}
	c := Case{Args: []json.RawMessage{}, Calls: []MethodCall{{MethodName: "clear", Args: []json.RawMessage{}, Expected: json.RawMessage("null")}}}
	if err := ValidateProblemCase(p, c, true); err != nil {
		t.Fatal(err)
	}
	if _, err := NewCaseCodec(p).Normalize(c, []byte(`[null]`)); err != nil {
		t.Fatal(err)
	}
	c.Calls[0].Expected = json.RawMessage("1")
	if err := ValidateProblemCase(p, c, true); err != nil {
		t.Fatal("void expectations should be ignored", err)
	}
	c.Calls[0].Expected = nil
	if string(NewCaseCodec(p).Expected(c)) != "[null]" {
		t.Fatal("void calls must not disable comparison of the remaining results")
	}
	actual, err := NewCaseCodec(p).Normalize(c, []byte(`[42]`))
	if err != nil || string(actual) != "[null]" {
		t.Fatal("void return checked", string(actual), err)
	}
}

func TestOdysseyPublicationWithVoidEntryMethod(t *testing.T) {
	c := odysseyContent(t)
	c.Problem.Signature.ReturnType = "void"
	c.Problem.Odyssey.Levels[0].Methods[0].ReturnType = "void"
	if err := ValidateQuestionPublication(c); err != nil {
		t.Fatal(err)
	}
	c.Problem.Odyssey = nil
	if err := ValidateQuestionPublication(c); err == nil {
		t.Fatal("ordinary questions cannot return void")
	}
}

func TestUnorderedMethodOutput(t *testing.T) {
	p := Problem{Odyssey: &Odyssey{Levels: []OdysseyLevel{{Methods: []Signature{{ClassName: "Solution", MethodName: "top_k", ReturnType: "list<str>", OutputOrder: "unordered"}, {ClassName: "Solution", MethodName: "words", ReturnType: "list<str>"}}}}}}
	c := Case{Calls: []MethodCall{{MethodName: "top_k"}, {MethodName: "words"}}}
	a, err := NewCaseCodec(p).Normalize(c, []byte(`[["z","a"],["z","a"]]`))
	if err != nil {
		t.Fatal(err)
	}
	b, err := NewCaseCodec(p).Normalize(c, []byte(`[["a","z"],["z","a"]]`))
	if err != nil {
		t.Fatal(err)
	}
	if string(a) != string(b) {
		t.Fatal("unordered IDs rejected", string(a), string(b))
	}
	different, _ := NewCaseCodec(p).Normalize(c, []byte(`[["a","z"],["a","z"]]`))
	if string(different) == string(a) {
		t.Fatal("ordered list normalized")
	}
	duplicate, _ := NewCaseCodec(p).Normalize(c, []byte(`[["a","a"],["z","a"]]`))
	if string(duplicate) == string(a) {
		t.Fatal("duplicates ignored")
	}
	if validOutputOrder(Signature{ReturnType: "str", OutputOrder: "unordered"}) {
		t.Fatal("unordered scalar allowed")
	}
}

func TestCaseCodecReusesQuestionAcrossCases(t *testing.T) {
	p := Problem{Odyssey: &Odyssey{Levels: []OdysseyLevel{{Methods: []Signature{
		{MethodName: "clear", ReturnType: "void"},
		{MethodName: "values", ReturnType: "list<int>", OutputOrder: "unordered"},
	}}}}}
	codec := NewCaseCodec(p)
	c := Case{Calls: []MethodCall{{MethodName: "clear"}, {MethodName: "values", Expected: json.RawMessage(`[2,1]`)}}}
	want, err := codec.Normalize(c, codec.Expected(c))
	if err != nil {
		t.Fatal(err)
	}
	got, err := codec.Normalize(c, json.RawMessage(`[99,[1,2]]`))
	if err != nil || string(got) != string(want) {
		t.Fatalf("got %s, want %s: %v", got, want, err)
	}
	c.Calls[1].Expected = nil
	if codec.Expected(c) != nil {
		t.Fatal("missing expectation became comparable")
	}
	c.Calls[1].MethodName = "unknown"
	if _, err = codec.Normalize(c, json.RawMessage(`[null,[]]`)); err == nil {
		t.Fatal("unknown method accepted")
	}
}
