package problems

import (
	"encoding/json"
	"strings"
	"testing"
)

func metadataProblem() Problem {
	return Problem{Signature: Signature{Parameters: []Parameter{{Name: "loads", Type: "list<int>"}, {Name: "groups", Type: "int"}}, ReturnType: "int"}}
}
func TestStructuredAdmission(t *testing.T) {
	p := metadataProblem()
	err := json.Unmarshal([]byte(`[{"kind":"range","target":{"parameter":"groups","projection":"value"},"min":1},{"kind":"range","target":{"parameter":"loads","projection":"elements"},"min":0},{"kind":"comparison","left":{"parameter":"groups","projection":"value"},"right":{"parameter":"loads","projection":"length"},"operator":"le"}]`), &p.Constraints)
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		args  string
		valid bool
		name  string
	}{{`[[2,3],2]`, true, ""}, {`[[2,3],3]`, false, "groups"}, {`[[-2,3],1]`, false, "loads"}, {`[[2,3],0]`, false, "groups"}, {`[2,[2,3]]`, false, "loads"}} {
		var args []json.RawMessage
		_ = json.Unmarshal([]byte(test.args), &args)
		err := ValidateProblemCustomCases(p, []Case{{Args: args}})
		if (err == nil) != test.valid {
			t.Fatalf("%s: %v", test.args, err)
		}
		if !test.valid && !strings.Contains(err.Error(), test.name) {
			t.Fatal(err)
		}
	}
}
func TestConstraintMetadata(t *testing.T) {
	sig := metadataProblem().Signature
	for _, data := range []string{`{"kind":"unknown"}`, `{"kind":"range","target":{"parameter":"missing","projection":"value"},"min":0}`, `{"kind":"range","target":{"parameter":"groups","projection":"length"},"min":0}`, `{"kind":"range","target":{"parameter":"loads","projection":"elements"}}`, `{"kind":"comparison","left":{"parameter":"loads","projection":"elements"},"right":{"parameter":"groups","projection":"value"},"operator":"le"}`, `{"kind":"property","target":{"parameter":"groups","projection":"value"},"property":"sorted"}`, `{"kind":"range","target":{"parameter":"groups","projection":"value"},"min":2,"max":1}`, `{"kind":"prose","text":"note","unknown":1}`, `{"kind":"prose","text":"note","target":{"parameter":"groups","projection":"value","unknown":1}}`} {
		var c Constraint
		err := json.Unmarshal([]byte(data), &c)
		if err == nil {
			err = ValidateConstraints(sig, []Constraint{c})
		}
		if err == nil {
			t.Fatalf("accepted %s", data)
		}
	}
	sig.Parameters = append(sig.Parameters, sig.Parameters[0])
	if ValidateConstraints(sig, nil) == nil {
		t.Fatal("duplicate names")
	}
	sig = metadataProblem().Signature
	sig.Parameters[0].Type = "optional<list<int>>"
	if ValidateConstraints(sig, []Constraint{{Kind: "property", Target: &ConstraintTarget{Parameter: "loads", Projection: "elements"}, Property: "unique"}}) == nil {
		t.Fatal("nullable projection")
	}
}
func TestConstraintProperties(t *testing.T) {
	p := metadataProblem()
	for _, property := range []string{"sorted", "nondecreasing", "unique"} {
		p.Constraints = []Constraint{{Kind: "property", Target: &ConstraintTarget{Parameter: "loads", Projection: "elements"}, Property: property}}
		for _, data := range []string{`[1,2,3]`, `[3,1,2]`, `[1,1,2]`} {
			c := Case{Args: []json.RawMessage{json.RawMessage(data), json.RawMessage(`1`)}}
			valid := data == `[1,2,3]` || data == `[3,1,2]` && property == "unique" || data == `[1,1,2]` && property != "unique"
			if (ValidateProblemCase(p, c, false) == nil) != valid {
				t.Fatalf("%s %s", property, data)
			}
		}
	}
}
func TestLegacyConstraints(t *testing.T) {
	c := Constraint{Kind: "range", Target: &ConstraintTarget{Parameter: "old"}}
	if err := json.Unmarshal([]byte(` "Legacy guarantee." `), &c); err != nil {
		t.Fatal(err)
	}
	if c.Kind != "prose" || c.Text != "Legacy guarantee." || c.Target != nil {
		t.Fatal(c)
	}
	p := metadataProblem()
	p.Constraints = []Constraint{c}
	if err := ValidateProblemCase(p, Case{Args: []json.RawMessage{json.RawMessage(`[]`), json.RawMessage(`-2`)}}, false); err != nil {
		t.Fatal(err)
	}
}
func TestNodeAndUnicodeProjections(t *testing.T) {
	p := Problem{Signature: Signature{Parameters: []Parameter{{Name: "root", Type: "TreeNode"}, {Name: "text", Type: "str"}}, ReturnType: "int"}}
	max := float64(2)
	p.Constraints = []Constraint{{Kind: "range", Target: &ConstraintTarget{Parameter: "root", Projection: "nodeCount"}, Max: &max}, {Kind: "range", Target: &ConstraintTarget{Parameter: "text", Projection: "length"}, Max: &max}}
	c := Case{Args: []json.RawMessage{json.RawMessage(`[1,null,2]`), json.RawMessage(`"αβ"`)}}
	if err := ValidateProblemCase(p, c, false); err != nil {
		t.Fatal(err)
	}
	c.Args[0] = json.RawMessage(`[1,2,3]`)
	if ValidateProblemCase(p, c, false) == nil {
		t.Fatal("excess nodes")
	}
}

func TestComparisonOperators(t *testing.T) {
	p := Problem{Signature: Signature{Parameters: []Parameter{{Name: "a", Type: "int"}, {Name: "b", Type: "int"}}, ReturnType: "int"}}
	for _, test := range []struct {
		operator string
		a, b     string
		valid    bool
	}{{"eq", "2", "2", true}, {"eq", "2", "3", false}, {"lt", "2", "3", true}, {"lt", "3", "2", false}, {"le", "2", "2", true}, {"gt", "3", "2", true}, {"gt", "2", "3", false}, {"ge", "2", "2", true}} {
		p.Constraints = []Constraint{{Kind: "comparison", Left: &ConstraintTarget{Parameter: "a", Projection: "value"}, Right: &ConstraintTarget{Parameter: "b", Projection: "value"}, Operator: test.operator}}
		if (ValidateProblemCase(p, Case{Args: []json.RawMessage{json.RawMessage(test.a), json.RawMessage(test.b)}}, false) == nil) != test.valid {
			t.Fatalf("%s %s %s", test.a, test.operator, test.b)
		}
	}
}
func TestExampleMetadataDoesNotReachExecution(t *testing.T) {
	var p Problem
	if err := json.Unmarshal([]byte(`{"examples":[{"args":[1],"expected":2,"explanation":"display only"}]}`), &p); err != nil {
		t.Fatal(err)
	}
	if p.Examples[0].Explanation != "display only" {
		t.Fatal("lost explanation")
	}
	data, err := json.Marshal(p.SampleCases())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "explanation") {
		t.Fatal(string(data))
	}
}

func TestStructuredFixtures(t *testing.T) {
	fixtures, err := LoadFixtures("../../../../fixtures/problems")
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range fixtures {
		if len(f.Problem.Constraints) == 0 || len(f.Problem.Examples) == 0 {
			t.Fatal(f.Problem.Slug)
		}
		for _, e := range f.Problem.Examples {
			if e.Explanation == "" {
				t.Fatal("missing explanation", f.Problem.Slug)
			}
		}
	}
}
