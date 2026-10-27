package engine

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/worker"
	"github.com/ethan-ngai/quorem/internal/execution"
)

func TestPostgresSandbox(t *testing.T) {
	if os.Getenv("QUOREM_TEST_POSTGRES_DOCKER") != "1" {
		t.Skip("QUOREM_TEST_POSTGRES_DOCKER=1 enables PostgreSQL sandbox tests")
	}
	var fixture worker.Fixture
	if err := json.Unmarshal([]byte(`{"problem":{"sql":{"dialect":"postgresql","outputOrder":"unordered"}},"hiddenCases":[]}`), &fixture); err != nil {
		t.Fatal(err)
	}
	var c worker.Case
	if err := json.Unmarshal([]byte(`{"args":[{"tables":[{"name":"items","columns":[{"name":"id","type":"integer"}],"rows":[[2],[1],[1]]}]}],"expected":{"columns":["id"],"rows":[[1],[1],[2]]}}`), &c); err != nil {
		t.Fatal(err)
	}
	runtime, _ := execution.LanguageRuntime("postgresql")
	for _, test := range []struct {
		source string
		want   execution.Verdict
	}{
		{"SELECT id FROM items", execution.Accepted},
		{"SELECT DISTINCT id FROM items", execution.WrongAnswer},
		{"RESET SESSION AUTHORIZATION; CREATE TABLE escape (x int)", execution.RuntimeError},
		{"COPY items TO PROGRAM 'id'", execution.RuntimeError},
	} {
		t.Run(test.source, func(t *testing.T) {
			d := &Docker{Resolve: func(context.Context, execution.Job) (worker.Spec, error) {
				return worker.Spec{Source: test.source, Kind: "submit", Fixture: fixture, Cases: []worker.Case{c}}, nil
			}}
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			result, err := d.Execute(ctx, execution.Job{Language: "postgresql", SubmissionID: "sql", AttemptID: rand.Text(), RuntimeRevision: runtime.Revision, HarnessRevision: runtime.Harness, Limits: execution.DefaultLimits()})
			if err != nil || result.Verdict != test.want {
				t.Fatalf("%+v %v", result, err)
			}
		})
	}
	t.Run("schema-driven cases", func(t *testing.T) {
		var schemaFixture worker.Fixture
		var schemaCase worker.Case
		if err := json.Unmarshal([]byte(`{"problem":{"sql":{"dialect":"postgresql","outputOrder":"unordered","tables":[{"name":"items","columns":[{"name":"id","type":"integer"}]}],"output":[{"name":"id","type":"integer"}]}}}`), &schemaFixture); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal([]byte(`{"args":[{"tables":[{"name":"items","rows":[[2],[1]]}]}],"expected":{"rows":[[1],[2]]}}`), &schemaCase); err != nil {
			t.Fatal(err)
		}
		d := &Docker{Resolve: func(context.Context, execution.Job) (worker.Spec, error) {
			return worker.Spec{Source: "SELECT id FROM items", Kind: "submit", Fixture: schemaFixture, Cases: []worker.Case{schemaCase}}, nil
		}}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		result, err := d.Execute(ctx, execution.Job{Language: "postgresql", SubmissionID: "schema", AttemptID: rand.Text(), RuntimeRevision: runtime.Revision, HarnessRevision: runtime.Harness, Limits: execution.DefaultLimits()})
		if err != nil || result.Verdict != execution.Accepted {
			t.Fatalf("%+v %v", result, err)
		}
		schemaCase.Expected = json.RawMessage(`{"rows":[]}`)
		d.Resolve = func(context.Context, execution.Job) (worker.Spec, error) {
			return worker.Spec{Source: "SELECT id::bigint AS id FROM items WHERE false", Kind: "submit", Fixture: schemaFixture, Cases: []worker.Case{schemaCase}}, nil
		}
		result, err = d.Execute(ctx, execution.Job{Language: "postgresql", SubmissionID: "wrong-type", AttemptID: rand.Text(), RuntimeRevision: runtime.Revision, HarnessRevision: runtime.Harness, Limits: execution.DefaultLimits()})
		if err != nil || result.Verdict != execution.WrongAnswer {
			t.Fatalf("wrong output type: %+v %v", result, err)
		}
		d.Resolve = func(context.Context, execution.Job) (worker.Spec, error) {
			return worker.Spec{Source: "SELECT id::bigint AS id FROM items WHERE false", Kind: "run", Fixture: schemaFixture, Cases: []worker.Case{schemaCase}}, nil
		}
		result, err = d.Execute(ctx, execution.Job{Language: "postgresql", SubmissionID: "visible-types", AttemptID: rand.Text(), RuntimeRevision: runtime.Revision, HarnessRevision: runtime.Harness, Limits: execution.DefaultLimits()})
		if err != nil || len(result.PublicCaseResults) != 1 || len(result.PublicCaseResults[0].SQLTypes) != 1 || result.PublicCaseResults[0].SQLTypes[0] != "bigint" {
			t.Fatalf("missing actual output type: %+v %v", result, err)
		}
	})
	t.Run("numeric precision", func(t *testing.T) {
		numeric := c
		numeric.Expected = json.RawMessage(`{"columns":["amount"],"rows":[[{"$numeric":"12345678901234567890.1234567890"}]]}`)
		d := &Docker{Resolve: func(context.Context, execution.Job) (worker.Spec, error) {
			return worker.Spec{Source: "SELECT 12345678901234567890.123456789::numeric AS amount", Kind: "submit", Fixture: fixture, Cases: []worker.Case{numeric}}, nil
		}}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		result, err := d.Execute(ctx, execution.Job{Language: "postgresql", SubmissionID: "numeric", AttemptID: rand.Text(), RuntimeRevision: runtime.Revision, HarnessRevision: runtime.Harness, Limits: execution.DefaultLimits()})
		if err != nil || result.Verdict != execution.Accepted {
			t.Fatalf("%+v %v", result, err)
		}
	})

	t.Run("bigint precision", func(t *testing.T) {
		bigcase := c
		bigcase.Expected = json.RawMessage(`{"columns":["amount"],"rows":[[{"$bigint":"9223372036854775807"}]]}`)
		d := &Docker{Resolve: func(context.Context, execution.Job) (worker.Spec, error) {
			return worker.Spec{Source: "SELECT 9223372036854775807::bigint AS amount", Kind: "submit", Fixture: fixture, Cases: []worker.Case{bigcase}}, nil
		}}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		result, err := d.Execute(ctx, execution.Job{Language: "postgresql", SubmissionID: "bigint", AttemptID: rand.Text(), RuntimeRevision: runtime.Revision, HarnessRevision: runtime.Harness, Limits: execution.DefaultLimits()})
		if err != nil || result.Verdict != execution.Accepted {
			t.Fatalf("%+v %v", result, err)
		}
	})

}

func TestPostgresLeftJoinTextResult(t *testing.T) {
	if os.Getenv("QUOREM_TEST_POSTGRES_DOCKER") != "1" {
		t.Skip("requires PostgreSQL sandbox")
	}
	var fixture worker.Fixture
	if err := json.Unmarshal([]byte(`{"problem":{"sql":{"dialect":"postgresql","outputOrder":"unordered"}}}`), &fixture); err != nil {
		t.Fatal(err)
	}
	var c worker.Case
	if err := json.Unmarshal([]byte(`{"args":[{"tables":[{"name":"customers","columns":[{"name":"id","type":"integer"},{"name":"name","type":"text"}],"rows":[[1,"Ada"],[2,"Lin"],[3,"Sam"]]},{"name":"orders","columns":[{"name":"id","type":"integer"},{"name":"customer_id","type":"integer"}],"rows":[[10,1],[11,1],[12,3]]}]}],"expected":{"columns":["id","name"],"rows":[[2,"Lin"]]}}`), &c); err != nil {
		t.Fatal(err)
	}
	runtime, _ := execution.RuntimeForRevision("postgresql-17.6-v1", "quorem-postgresql-v1")
	d := &Docker{Resolve: func(context.Context, execution.Job) (worker.Spec, error) {
		return worker.Spec{Source: "-- Write your query here.\nSELECT c.id, name FROM customers c LEFT JOIN orders o\nON c.id = o.customer_id WHERE customer_id IS NULL;", Kind: "run", Fixture: fixture, Cases: []worker.Case{c}}, nil
	}}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	result, err := d.Execute(ctx, execution.Job{Language: "postgresql", SubmissionID: "join-text", AttemptID: rand.Text(), RuntimeRevision: runtime.Revision, HarnessRevision: runtime.Harness, Limits: execution.DefaultLimits()})
	if err != nil || result.Verdict != execution.Accepted {
		t.Fatalf("%+v %v", result, err)
	}
}

func TestPostgresVisibleDiagnosticsAndHiddenRedaction(t *testing.T) {
	if os.Getenv("QUOREM_TEST_POSTGRES_DOCKER") != "1" {
		t.Skip("requires PostgreSQL sandbox")
	}
	var fixture worker.Fixture
	if err := json.Unmarshal([]byte(`{"problem":{"sql":{"dialect":"postgresql","outputOrder":"unordered"}}}`), &fixture); err != nil {
		t.Fatal(err)
	}
	var sample worker.Case
	if err := json.Unmarshal([]byte(`{"args":[{"tables":[{"name":"items","columns":[{"name":"id","type":"text"}],"rows":[["1"]]}]}],"expected":{"columns":["id"],"rows":[[1]]}}`), &sample); err != nil {
		t.Fatal(err)
	}
	var private worker.Case
	if err := json.Unmarshal([]byte(`{"args":[{"tables":[{"name":"items","columns":[{"name":"id","type":"text"}],"rows":[["private-error-marker"]]}]}],"expected":{"columns":["id"],"rows":[[1]]}}`), &private); err != nil {
		t.Fatal(err)
	}
	runtime, _ := execution.LanguageRuntime("postgresql")
	for _, test := range []struct {
		name, source, message string
		verdict               execution.Verdict
	}{
		{"syntax", "SELEC\n id FROM items", "syntax error", execution.SyntaxError},
		{"missing column", "SELECT\n missing FROM items", "column", execution.RuntimeError},
		{"unsupported type", "SELECT ARRAY[1] AS id", "unsupported column type", execution.InvalidOutput},
		{"no columns", "SELECT FROM items", "at least one column", execution.InvalidOutput},
	} {
		t.Run(test.name, func(t *testing.T) {
			d := &Docker{Resolve: func(context.Context, execution.Job) (worker.Spec, error) {
				return worker.Spec{Source: test.source, Kind: "run", Fixture: fixture, Cases: []worker.Case{sample}}, nil
			}}
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			result, err := d.Execute(ctx, execution.Job{Language: "postgresql", SubmissionID: "diagnostic", AttemptID: rand.Text(), RuntimeRevision: runtime.Revision, HarnessRevision: runtime.Harness, Limits: execution.DefaultLimits()})
			if err != nil || result.Verdict != test.verdict || len(result.PublicCaseResults) != 1 || len(result.PublicCaseResults[0].Diagnostics) != 1 || !strings.Contains(result.PublicCaseResults[0].Diagnostics[0].Message, test.message) {
				t.Fatalf("%+v %v", result, err)
			}
			if test.name == "missing column" && result.PublicCaseResults[0].Diagnostics[0].Line != 2 {
				t.Fatalf("missing line: %+v", result.PublicCaseResults[0])
			}
		})
	}
	t.Run("hidden data", func(t *testing.T) {
		d := &Docker{Resolve: func(context.Context, execution.Job) (worker.Spec, error) {
			return worker.Spec{Source: "SELECT id::integer AS id FROM items", Kind: "submit", Fixture: fixture, Cases: []worker.Case{private}, SubmitSamples: []worker.Case{sample}}, nil
		}}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		result, err := d.Execute(ctx, execution.Job{Language: "postgresql", SubmissionID: "private", AttemptID: rand.Text(), RuntimeRevision: runtime.Revision, HarnessRevision: runtime.Harness, Limits: execution.DefaultLimits()})
		encoded, _ := json.Marshal(result)
		if err != nil || strings.Contains(string(encoded), "private-error-marker") || len(result.SubmitSampleResults) != 1 || result.SubmitSampleResults[0].Status != "accepted" {
			t.Fatalf("hidden diagnostic leaked or sample failed: %s %v", encoded, err)
		}
	})
	t.Run("hidden dynamic syntax", func(t *testing.T) {
		var hidden, visible worker.Case
		if err := json.Unmarshal([]byte(`{"args":[{"tables":[{"name":"items","columns":[{"name":"id","type":"text"}],"rows":[["PRIVATE_SYNTAX_MARKER"]]}]}],"expected":{"columns":["id"],"rows":[]}}`), &hidden); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal([]byte(`{"args":[{"tables":[{"name":"items","columns":[{"name":"id","type":"text"}],"rows":[["SELECT 1"]]}]}],"expected":{"columns":["id"],"rows":[]}}`), &visible); err != nil {
			t.Fatal(err)
		}
		d := &Docker{Resolve: func(context.Context, execution.Job) (worker.Spec, error) {
			return worker.Spec{Source: "SELECT query_to_xml(id, true, false, '')::text AS id FROM items", Kind: "submit", Fixture: fixture, Cases: []worker.Case{hidden}, SubmitSamples: []worker.Case{visible}}, nil
		}}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		result, err := d.Execute(ctx, execution.Job{Language: "postgresql", SubmissionID: "private-syntax", AttemptID: rand.Text(), RuntimeRevision: runtime.Revision, HarnessRevision: runtime.Harness, Limits: execution.DefaultLimits()})
		encoded, _ := json.Marshal(result)
		if err != nil || result.Verdict != execution.SyntaxError || strings.Contains(string(encoded), "PRIVATE_SYNTAX_MARKER") || len(result.SubmitSampleResults) != 1 || result.SubmitSampleResults[0].Status == "syntax_error" {
			t.Fatalf("hidden syntax leaked or sample reused hidden error: %s %v", encoded, err)
		}
	})

}
