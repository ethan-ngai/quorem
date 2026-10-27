package engine

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"os"
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
