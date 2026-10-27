package problems

import (
	"encoding/json"
	"testing"
)

func TestSQLResultsPreserveDuplicatesAndOrdering(t *testing.T) {
	p := Problem{SQL: &SQLConfig{Dialect: "postgresql", OutputOrder: "unordered"}}
	a, err := NormalizeCaseOutput(p, Case{}, json.RawMessage(`{"columns":["x"],"rows":[[2],[1],[1],[null]]}`))
	if err != nil {
		t.Fatal(err)
	}
	b, err := NormalizeCaseOutput(p, Case{}, json.RawMessage(`{"columns":["x"],"rows":[[1],[null],[2],[1]]}`))
	if err != nil || string(a) != string(b) {
		t.Fatal(string(a), string(b), err)
	}
	c, _ := NormalizeCaseOutput(p, Case{}, json.RawMessage(`{"columns":["x"],"rows":[[1],[null],[2]]}`))
	if string(a) == string(c) {
		t.Fatal("duplicate lost")
	}
	p.SQL.OutputOrder = "ordered"
	a, _ = NormalizeCaseOutput(p, Case{}, json.RawMessage(`{"columns":["x"],"rows":[[1],[2]]}`))
	b, _ = NormalizeCaseOutput(p, Case{}, json.RawMessage(`{"columns":["x"],"rows":[[2],[1]]}`))
	if string(a) == string(b) {
		t.Fatal("order lost")
	}
}
func TestSQLCaseRejectsInvalidSetup(t *testing.T) {
	p := Problem{SQL: &SQLConfig{Dialect: "postgresql", OutputOrder: "ordered"}}
	c := Case{Args: []json.RawMessage{json.RawMessage(`{"tables":[{"name":"users","columns":[{"name":"id","type":"integer"}],"rows":[[1]]}]}`)}, Expected: json.RawMessage(`{"columns":["id"],"rows":[[1]]}`)}
	if err := ValidateProblemCase(p, c, true); err != nil {
		t.Fatal(err)
	}
	c.Args[0] = json.RawMessage(`{"tables":[{"name":"users","columns":[{"name":"id","type":"integer); DROP TABLE users"}],"rows":[[1]]}]}`)
	if err := ValidateProblemCase(p, c, true); err == nil {
		t.Fatal("accepted invalid type")
	}
}

func TestSQLOdysseyRequiresCompatibleStages(t *testing.T) {
	var c QuestionContent
	if err := json.Unmarshal([]byte(`{"problem":{"sql":{"dialect":"postgresql","outputOrder":"unordered"},"odyssey":{"levels":[{"title":"First","statementMarkdown":"First","methods":[],"examples":[{"args":[{"tables":[{"name":"items","columns":[{"name":"id","type":"integer"}],"rows":[[1]]}]}],"expected":{"columns":["id"],"rows":[[1]]}}]},{"title":"Second","statementMarkdown":"Second","methods":[],"examples":[{"args":[{"tables":[{"name":"items","columns":[{"name":"id","type":"integer"}],"rows":[[2]]}]}],"expected":{"columns":["id"],"rows":[[2]]}}]}]}},"odysseyHiddenCases":[[{"args":[{"tables":[{"name":"items","columns":[{"name":"id","type":"integer"}],"rows":[[1]]}]}],"expected":{"columns":["id"],"rows":[[1]]}}],[{"args":[{"tables":[{"name":"items","columns":[{"name":"id","type":"integer"}],"rows":[[2]]}]}],"expected":{"columns":["id"],"rows":[[2]]}}]]}`), &c); err != nil {
		t.Fatal(err)
	}
	if err := validateSQLPublication(c); err != nil {
		t.Fatal(err)
	}
	_, cases, err := CompileOdyssey(Fixture{Problem: c.Problem, OdysseyHiddenCases: c.OdysseyHiddenCases}, 2, "submit")
	if err != nil || len(cases) != 2 {
		t.Fatal(cases, err)
	}
	c.OdysseyHiddenCases[1][0].Expected = json.RawMessage(`{"columns":["different"],"rows":[[2]]}`)
	if err := validateSQLPublication(c); err == nil {
		t.Fatal("accepted incompatible stage columns")
	}
	c.OdysseyHiddenCases[1][0].Expected = json.RawMessage(`{"columns":["id"],"rows":[["two"]]}`)
	if err := validateSQLPublication(c); err == nil {
		t.Fatal("accepted incompatible stage value types")
	}
}

func TestSQLNumericCanonicalization(t *testing.T) {
	p := Problem{SQL: &SQLConfig{Dialect: "postgresql", OutputOrder: "ordered"}}
	normalize := func(text string) string {
		t.Helper()
		result, err := NormalizeCaseOutput(p, Case{}, json.RawMessage(text))
		if err != nil {
			t.Fatal(err)
		}
		return string(result)
	}
	a := normalize(`{"columns":["x"],"rows":[[{"$numeric":"12345678901234567890.1200"}]]}`)
	b := normalize(`{"columns":["x"],"rows":[[{"$numeric":"12345678901234567890.12"}]]}`)
	if a != b {
		t.Fatal(a, b)
	}
	if a == normalize(`{"columns":["x"],"rows":[["12345678901234567890.12"]]}`) {
		t.Fatal("numeric conflated with text")
	}
}
