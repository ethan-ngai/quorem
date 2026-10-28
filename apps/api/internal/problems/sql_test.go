package problems

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/ethan-ngai/quorem/internal/execution"
)

func TestSQLResultsPreserveDuplicatesAndOrdering(t *testing.T) {
	p := Problem{QuestionDefinition: QuestionDefinition{SQL: &SQLConfig{Dialect: "postgresql", OutputOrder: "unordered"}}}
	a, err := NewCaseCodec(p).Normalize(Case{}, json.RawMessage(`{"columns":["x"],"rows":[[2],[1],[1],[null]]}`))
	if err != nil {
		t.Fatal(err)
	}
	b, err := NewCaseCodec(p).Normalize(Case{}, json.RawMessage(`{"columns":["x"],"rows":[[1],[null],[2],[1]]}`))
	if err != nil || string(a) != string(b) {
		t.Fatal(string(a), string(b), err)
	}
	c, _ := NewCaseCodec(p).Normalize(Case{}, json.RawMessage(`{"columns":["x"],"rows":[[1],[null],[2]]}`))
	if string(a) == string(c) {
		t.Fatal("duplicate lost")
	}
	p.SQL.OutputOrder = "ordered"
	a, _ = NewCaseCodec(p).Normalize(Case{}, json.RawMessage(`{"columns":["x"],"rows":[[1],[2]]}`))
	b, _ = NewCaseCodec(p).Normalize(Case{}, json.RawMessage(`{"columns":["x"],"rows":[[2],[1]]}`))
	if string(a) == string(b) {
		t.Fatal("order lost")
	}
}
func TestSQLCaseFollowsSchema(t *testing.T) {
	p := Problem{QuestionDefinition: QuestionDefinition{SQL: &SQLConfig{Dialect: "postgresql", OutputOrder: "unordered", Tables: []SQLTableSchema{{Name: "users", Columns: []SQLColumn{{Name: "id", Type: "integer"}}}}, Output: []SQLColumn{{Name: "id", Type: "integer"}}}}}
	var c Case
	if err := json.Unmarshal([]byte(`{"args":[{"tables":[{"name":"users","rows":[[1]]}]}],"expected":{"rows":[[1]]}}`), &c); err != nil {
		t.Fatal(err)
	}
	if err := ValidateProblemCase(p, c, true); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct{ setup, expected string }{
		{`{"tables":[{"name":"other","rows":[[1]]}]}`, `{"rows":[[1]]}`},
		{`{"tables":[{"name":"users","rows":[["wrong"]]}]}`, `{"rows":[[1]]}`},
		{`{"tables":[{"name":"users","rows":[[1]]}]}`, `{"rows":[["wrong"]]}`},
		{`{"tables":[{"name":"users","columns":[],"rows":[[1]]}]}`, `{"columns":["id"],"rows":[[1]]}`},
	} {
		c.Args[0] = json.RawMessage(test.setup)
		c.Expected = json.RawMessage(test.expected)
		if err := ValidateProblemCase(p, c, true); err == nil {
			t.Fatal("accepted invalid SQL case", test)
		}
	}
}

func TestSQLOdysseyRequiresSchema(t *testing.T) {
	var c QuestionContent
	if err := json.Unmarshal([]byte(`{"problem":{"sql":{"dialect":"postgresql","outputOrder":"unordered","tables":[{"name":"items","columns":[{"name":"id","type":"integer"}]}],"output":[{"name":"id","type":"integer"}]},"odyssey":{"levels":[{"title":"First","statementMarkdown":"First","methods":[],"examples":[{"args":[{"tables":[{"name":"items","rows":[[1]]}]}],"expected":{"rows":[[1]]}}]}]}},"odysseyHiddenCases":[[{"args":[{"tables":[{"name":"items","rows":[[1]]}]}],"expected":{"rows":[[1]]}}]]}`), &c); err != nil {
		t.Fatal(err)
	}
	if err := validateSQLPublication(c); err != nil {
		t.Fatal(err)
	}
	c.OdysseyHiddenCases[0][0].Expected = json.RawMessage(`{"rows":[["wrong"]]}`)
	if err := validateSQLPublication(c); err == nil {
		t.Fatal("accepted incompatible result")
	}
}

func TestSQLNumericCanonicalization(t *testing.T) {
	p := Problem{QuestionDefinition: QuestionDefinition{SQL: &SQLConfig{Dialect: "postgresql", OutputOrder: "ordered"}}}
	normalize := func(text string) string {
		t.Helper()
		result, err := NewCaseCodec(p).Normalize(Case{}, json.RawMessage(text))
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

func TestLegacySQLCasesRemainRunnableButRequireSchemaForPublication(t *testing.T) {
	p := Problem{QuestionDefinition: QuestionDefinition{SQL: &SQLConfig{Dialect: "postgresql", OutputOrder: "unordered"}}}
	var c Case
	if err := json.Unmarshal([]byte(`{"args":[{"tables":[{"name":"items","columns":[{"name":"id","type":"integer"}],"rows":[[1]]}]}],"expected":{"columns":["id"],"rows":[[1]]}}`), &c); err != nil {
		t.Fatal(err)
	}
	if err := ValidateProblemCase(p, c, true); err != nil {
		t.Fatal(err)
	}
	if err := validateSQLPublication(QuestionContent{Problem: p.QuestionDefinition}); err == nil {
		t.Fatal("accepted publication without a schema")
	}
}

func TestSQLFloatingResultsNormalizeByPseudotype(t *testing.T) {
	p := Problem{QuestionDefinition: QuestionDefinition{SQL: &SQLConfig{OutputOrder: "ordered", Output: []SQLColumn{{Name: "value", Type: "real"}}}}}
	expected, err := NewCaseCodec(p).Normalize(Case{}, json.RawMessage(`{"rows":[[0.1],[10000000000]]}`))
	if err != nil {
		t.Fatal(err)
	}
	actual, err := NewCaseCodec(p).Normalize(Case{}, json.RawMessage(`{"columns":["value"],"rows":[[0.10000000149011612],[10000000000.0]]}`))
	if err != nil || string(expected) != string(actual) {
		t.Fatalf("%s != %s: %v", expected, actual, err)
	}
}

func TestSQLTimestampsNormalizeByColumnType(t *testing.T) {
	problem := Problem{QuestionDefinition: QuestionDefinition{SQL: &SQLConfig{Dialect: "postgresql", OutputOrder: "ordered", Output: []SQLColumn{{Name: "wall", Type: "timestamp"}, {Name: "instant", Type: "timestamptz"}}}}}
	codec := NewCaseCodec(problem)
	actual, err := codec.Normalize(Case{}, json.RawMessage(`{"columns":["wall","instant"],"rows":[["2024-01-01T12:00:00.123457","2024-01-01T10:00:00+00:00"]]}`))
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{
		`{"rows":[["2024-01-01 12:00:00.1234567","2024-01-01T12:00:00+02:00"]]}`,
		`{"rows":[["2024-01-01T12:00:00.1234570","2024-01-01 10:00:00"]]}`,
		`{"rows":[["2024-01-01 12:00:00.123457","2024-01-01 12:00:00+02:00"]]}`,
	} {
		result, err := codec.Normalize(Case{}, json.RawMessage(expected))
		if err != nil || string(result) != string(actual) {
			t.Fatalf("%s != %s: %v", result, actual, err)
		}
	}
	for input, want := range map[string]string{
		"2024-01-01 12:00:00.1234565":    "2024-01-01T12:00:00.123456",
		"2024-01-01 12:00:00.1234575":    "2024-01-01T12:00:00.123458",
		"2024-01-01 12:00:00.1234565001": "2024-01-01T12:00:00.123457",
	} {
		if got, err := normalizeSQLTimestamp("timestamp", input); err != nil || got != want {
			t.Fatalf("round %s: %s %v", input, got, err)
		}
	}
	if _, err := codec.Normalize(Case{}, json.RawMessage(`{"rows":[["invalid","2024-01-01T10:00:00Z"]]}`)); err == nil {
		t.Fatal("invalid timestamp accepted")
	}
}

func TestSQLRealExpectedValuesFitColumnPrecision(t *testing.T) {
	for _, test := range []struct {
		kind, value string
		valid       bool
	}{
		{"real", "3.4028235e38", true},
		{"real", "3.5e38", false},
		{"double precision", "3.5e38", true},
		{"double precision", "1e309", false},
	} {
		if got := validSQLResultValue(test.kind, json.RawMessage(test.value)); got != test.valid {
			t.Errorf("%s %s: got %v", test.kind, test.value, got)
		}
	}
}

func sqlQuestionForValidation(t *testing.T, staged bool) QuestionContent {
	t.Helper()
	var c QuestionContent
	if err := json.Unmarshal([]byte(`{"problem":{"slug":"sql-example","title":"SQL example","difficulty":"easy","statementMarkdown":"Query items","sql":{"dialect":"postgresql","outputOrder":"unordered","tables":[{"name":"items","columns":[{"name":"id","type":"integer"}]}],"output":[{"name":"id","type":"integer"}]}},"attribution":"Example"}`), &c); err != nil {
		t.Fatal(err)
	}
	c.Problem.Limits = execution.DefaultLimits()
	var test Case
	if err := json.Unmarshal([]byte(`{"args":[{"tables":[{"name":"items","rows":[[1]]}]}],"expected":{"rows":[[1]]}}`), &test); err != nil {
		t.Fatal(err)
	}
	if staged {
		c.Problem.Odyssey = &Odyssey{Levels: []OdysseyLevel{{Title: "First", StatementMarkdown: "Query items", Examples: []ProblemExample{{Case: test}}}}}
		c.OdysseyHiddenCases = [][]Case{{test}}
	} else {
		c.Problem.Examples = []ProblemExample{{Case: test}}
		c.HiddenCases = []Case{test}
	}
	runtime, _ := execution.LanguageRuntime("postgresql")
	c.Implementations = []AuthoringImplementation{{LanguageImplementation: LanguageImplementation{Language: "postgresql", StarterSource: "SELECT id FROM items", RuntimeRevision: runtime.Revision, HarnessRevision: runtime.Harness}, ReferenceSource: "SELECT id FROM items"}}
	return c
}

func TestSQLQuestionConstraints(t *testing.T) {
	for _, staged := range []bool{false, true} {
		for _, tc := range []struct {
			name       string
			constraint Constraint
			valid      bool
		}{
			{"prose", Constraint{Kind: "prose", Text: "Only active items are included."}, true},
			{"empty prose", Constraint{Kind: "prose", Text: " \t"}, false},
			{"prose with target", Constraint{Kind: "prose", Text: "Informational", Target: &ConstraintTarget{Parameter: "items", Projection: "length"}}, false},
			{"structured", Constraint{Kind: "range", Target: &ConstraintTarget{Parameter: "items", Projection: "length"}}, false},
			{"unknown", Constraint{Kind: "unknown"}, false},
		} {
			t.Run(fmt.Sprintf("staged=%t/%s", staged, tc.name), func(t *testing.T) {
				c := sqlQuestionForValidation(t, staged)
				c.Problem.Constraints = []Constraint{tc.constraint}
				for _, validate := range []func(QuestionContent) error{func(c QuestionContent) error { return ValidateQuestionDefinition(c, true) }, ValidateQuestionPublication} {
					if err := validate(c); (err == nil) != tc.valid {
						t.Fatalf("valid=%t: %v", tc.valid, err)
					}
				}
			})
		}
	}
}

func TestOdysseyLevelMetadataConsistentAcrossQuestionTypes(t *testing.T) {
	for _, tc := range []struct {
		name, title, statement string
		valid                  bool
	}{
		{"valid", "First", "A stage", true},
		{"blank title", " \t", "A stage", false},
		{"long title", strings.Repeat("x", 161), "A stage", false},
		{"blank statement", "First", " \n", false},
		{"long statement", "First", strings.Repeat("x", 65537), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			sql := sqlQuestionForValidation(t, true)
			sql.Problem.Odyssey.Levels[0].Title, sql.Problem.Odyssey.Levels[0].StatementMarkdown = tc.title, tc.statement
			if err := ValidateQuestionPublication(sql); (err == nil) != tc.valid {
				t.Fatalf("SQL valid=%t: %v", tc.valid, err)
			}
			coding := odysseyContent(t)
			coding.Problem.Odyssey.Levels[0].Title, coding.Problem.Odyssey.Levels[0].StatementMarkdown = tc.title, tc.statement
			if err := ValidateQuestionPublication(coding); (err == nil) != tc.valid {
				t.Fatalf("coding valid=%t: %v", tc.valid, err)
			}
		})
	}
}
