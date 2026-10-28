package problems

import (
	"encoding/json"
	"testing"
)

func TestTypedCodec(t *testing.T) {
	tests := []struct {
		typ, input, want string
		valid            bool
	}{{"int", "2147483647", "2147483647", true}, {"int", "2147483648", "", false}, {"int", "true", "", false}, {"int", "1.0", "", false}, {"ListNode", "[]", "null", true}, {"ListNode", "[1,null]", "", false}, {"TreeNode", "[1,null,2,null,null]", "[1,null,2]", true}, {"TreeNode", "[1,null,null,2]", "", false}, {"TreeNode", "[null,1]", "", false}, {"list<int>", "[1,-2]", "[1,-2]", true}, {"optional<int>", "null", "null", true}}
	for _, test := range tests {
		t.Run(test.typ+test.input, func(t *testing.T) {
			got, err := Normalize(test.typ, json.RawMessage(test.input))
			if (err == nil) != test.valid {
				t.Fatalf("error %v", err)
			}
			if test.valid && string(got) != test.want {
				t.Fatalf("got %s", got)
			}
		})
	}
}
func TestFixtures(t *testing.T) {
	fixtures, err := LoadFixtures("../../../../fixtures/problems")
	if err != nil {
		t.Fatal(err)
	}
	counts := map[string]int{}
	for _, f := range fixtures {
		counts[f.Problem.Difficulty]++
		if len(f.HiddenCases) != 20 || f.ReferenceSource == "" || f.Attribution == "" {
			t.Fatal("incomplete fixture")
		}
	}
	for _, difficulty := range []string{"easy", "medium", "hard"} {
		if counts[difficulty] != 2 {
			t.Fatal(counts)
		}
	}
}
func TestCodecBoundsAndCanonicalTrees(t *testing.T) {
	values := make([]int, 10000)
	data, _ := json.Marshal(values)
	if _, err := Normalize("list<int>", data); err != nil {
		t.Fatal("10000 elements rejected", err)
	}
	values = append(values, 0)
	data, _ = json.Marshal(values)
	if _, err := Normalize("list<int>", data); err == nil {
		t.Fatal("10001 elements accepted")
	}
	for _, input := range []string{"[null]", "[null,null]", "[1,null,null,null]"} {
		expected := "null"
		if input[1] == '1' {
			expected = "[1]"
		}
		got, err := Normalize("TreeNode", json.RawMessage(input))
		if err != nil || string(got) != expected {
			t.Fatal(input, string(got), err)
		}
	}
	if _, err := Normalize("int", json.RawMessage("1 2")); err == nil {
		t.Fatal("trailing value accepted")
	}
}

func TestCustomCaseAdmissionTypesAndBounds(t *testing.T) {
	sig := Signature{Parameters: []Parameter{{Name: "enabled", Type: "bool"}, {Name: "weights", Type: "list<list<float>>"}, {Name: "head", Type: "optional<ListNode>"}}, ReturnType: "TreeNode"}
	valid := Case{Args: []json.RawMessage{json.RawMessage("true"), json.RawMessage("[[1.25],[]]"), json.RawMessage("null")}, Expected: json.RawMessage("[1,null,2]")}
	if err := ValidateProblemCustomCases(Problem{QuestionDefinition: QuestionDefinition{Signature: sig}}, []Case{valid}); err != nil {
		t.Fatal(err)
	}
	for name, c := range map[string]Case{
		"arity":           {Args: []json.RawMessage{json.RawMessage("true")}},
		"bool coercion":   {Args: []json.RawMessage{json.RawMessage("1"), json.RawMessage("[]"), json.RawMessage("null")}},
		"nested scalar":   {Args: []json.RawMessage{json.RawMessage("true"), json.RawMessage("[[false]]"), json.RawMessage("null")}},
		"nonfinite float": {Args: []json.RawMessage{json.RawMessage("true"), json.RawMessage("[[1e400]]"), json.RawMessage("null")}},
		"linked gap":      {Args: []json.RawMessage{json.RawMessage("true"), json.RawMessage("[]"), json.RawMessage("[1,null]")}},
		"orphan output":   {Args: valid.Args, Expected: json.RawMessage("[1,null,null,2]")},
	} {
		t.Run(name, func(t *testing.T) {
			if err := ValidateProblemCustomCases(Problem{QuestionDefinition: QuestionDefinition{Signature: sig}}, []Case{c}); err == nil {
				t.Fatal("malformed custom case accepted")
			}
		})
	}
	if err := ValidateProblemCustomCases(Problem{QuestionDefinition: QuestionDefinition{Signature: sig}}, []Case{}); err == nil {
		t.Fatal("empty custom suite accepted")
	}
	if err := ValidateProblemCustomCases(Problem{QuestionDefinition: QuestionDefinition{Signature: sig}}, make([]Case, 21)); err == nil {
		t.Fatal("21 cases accepted")
	}
	largeString, _ := json.Marshal(string(make([]byte, 2<<20)))
	if err := ValidateProblemCustomCases(Problem{QuestionDefinition: QuestionDefinition{Signature: Signature{Parameters: []Parameter{{Name: "text", Type: "str"}}, ReturnType: "str"}}}, []Case{{Args: []json.RawMessage{largeString}}}); err == nil {
		t.Fatal("oversized custom suite accepted")
	}
	for _, typ := range []string{"optional<Graph>", "list<Graph>"} {
		input := "null"
		if typ == "list<Graph>" {
			input = "[]"
		}
		if _, err := Normalize(typ, json.RawMessage(input)); err == nil {
			t.Fatal("unknown nested codec accepted", typ)
		}
	}
}

func TestLargeInputIsBoundedPerProblem(t *testing.T) {
	sig := Signature{Parameters: []Parameter{{Name: "values", Type: "list<int>"}}, ReturnType: "int"}
	data, _ := json.Marshal(make([]int, 100000))
	c := Case{Args: []json.RawMessage{data}, Expected: json.RawMessage(`0`)}
	p := Problem{QuestionDefinition: QuestionDefinition{Signature: sig}}
	p.Limits.MaxCollectionElements = 100000
	maximum := float64(100000)
	p.Constraints = []Constraint{{Kind: "range", Target: &ConstraintTarget{Parameter: "values", Projection: "length"}, Max: &maximum}}
	if err := ValidateProblemCustomCases(p, []Case{c}); err != nil {
		t.Fatal(err)
	}
	p.Limits.MaxCollectionElements = 10000
	if err := ValidateProblemCustomCases(p, []Case{c}); err == nil {
		t.Fatal("problem limit was ignored")
	}
	p.Limits.MaxCollectionElements = 100000
	data, _ = json.Marshal(make([]int, 100001))
	c.Args[0] = data
	if err := ValidateProblemCustomCases(p, []Case{c}); err == nil {
		t.Fatal("platform input limit was ignored")
	}
	if _, err := Normalize("list<int>", data); err == nil {
		t.Fatal("output collection limit changed")
	}
}

func TestFloatSignedZeroParity(t *testing.T) {
	for _, input := range []string{"0", "-0", "0.0", "-0.0", "-0e100"} {
		got, err := Normalize("float", json.RawMessage(input))
		if err != nil || string(got) != "0" {
			t.Fatal(input, string(got), err)
		}
	}
	got, err := Normalize("list<float>", json.RawMessage("[-0.0,0.0]"))
	if err != nil || string(got) != "[0,0]" {
		t.Fatal(string(got), err)
	}
}

func TestArrayPseudoType(t *testing.T) {
	for _, typ := range []string{"array<int>", "list<int>"} {
		got, err := Normalize(typ, []byte(`[1,2]`))
		if err != nil || string(got) != `[1,2]` {
			t.Fatal(typ, string(got), err)
		}
	}
	if _, err := Normalize("array<int>", []byte(`[null]`)); err == nil {
		t.Fatal("null array integer")
	}
	for _, test := range []struct{ typ, language, want string }{{"list<int>", "java", "java.util.List<Integer>"}, {"array<int>", "java", "int[]"}, {"list<optional<str>>", "java", "java.util.List<String>"}} {
		got, err := languageType(test.typ, test.language)
		if err != nil || got != test.want {
			t.Fatal(test, got, err)
		}
	}
}
