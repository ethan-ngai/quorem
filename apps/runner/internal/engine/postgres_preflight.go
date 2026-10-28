package engine

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/worker"
	"github.com/ethan-ngai/quorem/internal/execution"
)

// VerifyPostgresSandbox runs PostgreSQL isolation probes against the configured case service.
func (d *Docker) VerifyPostgresSandbox(ctx context.Context) error {
	var fixture worker.Fixture
	if err := json.Unmarshal([]byte(`{"problem":{"sql":{"dialect":"postgresql","outputOrder":"unordered"}}}`), &fixture); err != nil {
		return err
	}
	var c worker.Case
	if err := json.Unmarshal([]byte(`{"args":[{"tables":[{"name":"items","columns":[{"name":"id","type":"integer"}],"rows":[[1]]}]}],"expected":{"columns":["id"],"rows":[[1]]}}`), &c); err != nil {
		return err
	}
	runtime, _ := execution.LanguageRuntime("postgresql")
	for _, probe := range []struct {
		name, source string
		want         execution.Verdict
	}{
		{"query", "SELECT id FROM items", execution.Accepted},
		{"authorization", "RESET SESSION AUTHORIZATION; COPY items TO PROGRAM 'id'", execution.RuntimeError},
		{"deadline", "SELECT pg_sleep(10)", execution.TimeLimit},
	} {
		engine := *d
		engine.Resolve = func(context.Context, execution.Job) (worker.Spec, error) {
			return worker.Spec{Source: probe.source, Kind: "submit", Problem: fixture.Problem, Cases: []worker.Case{c}}, nil
		}
		attempt := "postgres-preflight-" + rand.Text()
		bounded, cancel := context.WithTimeout(ctx, 120*time.Second)
		result, err := engine.Execute(bounded, execution.Job{Language: "postgresql", AttemptID: attempt, SubmissionID: attempt, RuntimeRevision: runtime.Revision, HarnessRevision: runtime.Harness, Limits: execution.DefaultLimits()})
		cancel()
		if err != nil || result.Verdict != probe.want {
			return fmt.Errorf("PostgreSQL sandbox %s attempt %s: expected %s, got %s: %v", probe.name, attempt, probe.want, result.Verdict, err)
		}
	}
	return nil
}
