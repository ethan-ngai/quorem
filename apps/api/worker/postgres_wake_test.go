package worker

import (
	"context"
	"errors"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/postgres"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/internal/execution"
)

func executionWakeStore(t *testing.T) *postgres.Store {
	t.Helper()
	url := os.Getenv("QUOREM_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("QUOREM_TEST_DATABASE_URL enables disposable execution integration")
	}
	store, err := postgres.OpenRunner(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(store.Pool.Close)
	if err = store.Migrate(context.Background(), "../migrations"); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Pool.Exec(context.Background(), "TRUNCATE workspaces,problem_versions CASCADE;UPDATE users SET admission_tokens=2,tokens_updated_at=clock_timestamp()"); err != nil {
		t.Fatal(err)
	}
	fixtures, err := LoadFixtures("../../../fixtures/problems")
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Seed(context.Background(), fixtures); err != nil {
		t.Fatal(err)
	}
	return store
}

func wakeAdmission(t *testing.T, store *postgres.Store, owner string) {
	t.Helper()
	ctx := context.Background()
	problem, err := store.Problem(ctx, "run-widths", false)
	if err != nil {
		t.Fatal(err)
	}
	workspace, err := store.CreateWorkspace(ctx, owner, problem.ID, "python")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Admit(ctx, owner, postgres.ID(), judging.Command{WorkspaceID: workspace.ID, Kind: "run", Source: "class Solution: pass"}, postgres.ID()); err != nil {
		t.Fatal(err)
	}
}

type retryWakeEngine struct {
	attempts  atomic.Int32
	started   chan struct{}
	failFirst bool
}

func (e *retryWakeEngine) Execute(ctx context.Context, j execution.Job) (execution.Completion, error) {
	attempt := e.attempts.Add(1)
	if e.started != nil {
		select {
		case e.started <- struct{}{}:
		default:
		}
	}
	select {
	case <-time.After(20 * time.Millisecond):
	case <-ctx.Done():
	}
	if e.failFirst && attempt == 1 {
		return execution.Completion{}, errors.New("transient engine unavailable")
	}
	return execution.Completion{SubmissionID: j.SubmissionID, AttemptID: j.AttemptID, Verdict: execution.Accepted}, nil
}

func TestPostgresDrainCoversWakeBeforeAdmissionAndDurableRetry(t *testing.T) {
	store := executionWakeStore(t)
	engine := &retryWakeEngine{failFirst: true, started: make(chan struct{}, 8)}
	service := New(store)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	type result struct {
		state    DrainState
		complete bool
		err      error
	}
	done := make(chan result, 1)
	go func() {
		state, complete, err := service.drain(ctx, engine, 2, 150*time.Millisecond)
		done <- result{state, complete, err}
	}()
	// This is the pre-admission durable wake arriving before either DB commit.
	time.Sleep(40 * time.Millisecond)
	wakeAdmission(t, store, "alice")
	wakeAdmission(t, store, "bob")
	r := <-done
	if r.err != nil || !r.complete || r.state.Queued != 0 || r.state.Running != 0 || engine.attempts.Load() != 3 {
		t.Fatalf("drain lost pending/retry jobs: %+v attempts=%d", r, engine.attempts.Load())
	}
}

func TestPostgresContinuousRunnerWakesWithoutRecoveryTick(t *testing.T) {
	store := executionWakeStore(t)
	engine := &retryWakeEngine{started: make(chan struct{}, 1)}
	service := New(store)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); _ = service.Run(ctx, engine) }()
	defer func() { cancel(); <-done }()
	// Allow the initial empty claim; the next recovery tick is five seconds away.
	time.Sleep(100 * time.Millisecond)
	started := time.Now()
	wakeAdmission(t, store, "alice")
	select {
	case <-engine.started:
		if time.Since(started) > time.Second {
			t.Fatal("notify execution waited for recovery")
		}
	case <-time.After(time.Second):
		t.Fatal("continuous runner missed committed wake")
	}
}
