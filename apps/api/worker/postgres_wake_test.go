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

func (e *retryWakeEngine) SandboxScope(context.Context) (string, error) { return "test-scope", nil }

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
	// Allow the initial empty claim before committing a new job.
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

func (e *deadlineReapEngine) SandboxScope(context.Context) (string, error) { return "test-scope", nil }

type deadlineReapEngine struct {
	reaped  chan string
	started chan execution.Job
}

func (e *deadlineReapEngine) TeardownAttempt(_ context.Context, attempt, _ string) error {
	e.reaped <- attempt
	return nil
}
func (e *deadlineReapEngine) Execute(_ context.Context, j execution.Job) (execution.Completion, error) {
	e.started <- j
	return execution.Completion{SubmissionID: j.SubmissionID, AttemptID: j.AttemptID, Verdict: execution.Accepted}, nil
}

func TestContinuousRunnerReapsAtAbandonedLeaseDeadline(t *testing.T) {
	store := executionWakeStore(t)
	wakeAdmission(t, store, "alice")
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	abandoned, err := store.ClaimAfterTeardown(ctx, false, "", "test-scope")
	if err != nil || abandoned.AttemptID == "" {
		t.Fatal(abandoned, err)
	}
	if _, err = store.Pool.Exec(ctx, `UPDATE execution_jobs SET lease_until=clock_timestamp()+interval '300 milliseconds' WHERE id=$1`, abandoned.JobID); err != nil {
		t.Fatal(err)
	}
	engine := &deadlineReapEngine{reaped: make(chan string, 1), started: make(chan execution.Job, 1)}
	service := New(store)
	done := make(chan struct{})
	go func() { defer close(done); _ = service.Run(ctx, engine) }()
	defer func() { cancel(); <-done; service.Close() }()
	select {
	case attempt := <-engine.reaped:
		if attempt != abandoned.AttemptID {
			t.Fatalf("wrong sandbox reaped %q", attempt)
		}
	case <-ctx.Done():
		t.Fatal("lease deadline did not trigger teardown")
	}
	select {
	case job := <-engine.started:
		if job.AttemptID == abandoned.AttemptID {
			t.Fatal("reused stale attempt")
		}
	case <-ctx.Done():
		t.Fatal("reaped job was not reclaimed")
	}
}

func TestPostgresDrainCutoffDoesNotClaimBehindQueueLock(t *testing.T) {
	store := executionWakeStore(t)
	ctx := context.Background()
	wakeAdmission(t, store, "alice")
	tx, err := store.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(740020)`); err != nil {
		t.Fatal(err)
	}
	engine := &retryWakeEngine{}
	service := New(store)
	deadline := time.Now().Add(100 * time.Millisecond)
	result := startCutoffDrain(service, engine, 1, deadline)
	r := <-result
	if r.err != nil || r.complete || r.state.Queued != 1 || engine.attempts.Load() != 0 {
		t.Fatalf("blocked drain: %+v attempts=%d", r, engine.attempts.Load())
	}
	var attempts int
	if err = store.Pool.QueryRow(ctx, `SELECT max(attempts) FROM execution_jobs WHERE NOT finished`).Scan(&attempts); err != nil || attempts != 0 {
		t.Fatalf("claim after cutoff: %d %v", attempts, err)
	}
	if err = tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	retryCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	state, complete, err := service.drain(retryCtx, engine, 1, 20*time.Millisecond)
	if err != nil || !complete || state.Queued != 0 || engine.attempts.Load() != 1 {
		t.Fatalf("retry: %+v %v %v attempts=%d", state, complete, err, engine.attempts.Load())
	}
}

type countedDeadlineStore struct {
	*postgres.Store
	claims    atomic.Int32
	snapshots chan struct{}
}

func (s *countedDeadlineStore) ClaimAfterTeardown(ctx context.Context, resumable bool, attempt, scope string) (execution.Job, error) {
	s.claims.Add(1)
	return s.Store.ClaimAfterTeardown(ctx, resumable, attempt, scope)
}
func (s *countedDeadlineStore) NextRunnableExecutionDeadline(ctx context.Context, resumable bool, scope string) (time.Duration, bool, error) {
	d, present, err := s.Store.NextRunnableExecutionDeadline(ctx, resumable, scope)
	select {
	case s.snapshots <- struct{}{}:
	default:
	}
	return d, present, err
}

func TestContinuousRunnerIgnoresUnsupportedLosslessDeadline(t *testing.T) {
	t.Setenv("QUOREM_LOSSLESS_CASES", "false")
	t.Setenv("QUOREM_LOSSLESS_RESULT_WRITES", "false")
	store := executionWakeStore(t)
	wakeAdmission(t, store, "alice")
	if _, err := store.Pool.Exec(context.Background(), `UPDATE submissions SET lossless_cases=convert_to('[]','UTF8') WHERE owner_id='alice'`); err != nil {
		t.Fatal(err)
	}
	counted := &countedDeadlineStore{Store: store, snapshots: make(chan struct{}, 2)}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { defer close(done); _ = New(counted).Run(ctx, &retryWakeEngine{}) }()
	select {
	case <-counted.snapshots:
	case <-time.After(2 * time.Second):
		cancel()
		<-done
		t.Fatal("runner never read deadline")
	}
	before := counted.claims.Load()
	time.Sleep(750 * time.Millisecond)
	after := counted.claims.Load()
	cancel()
	<-done
	if before != 1 || after != before {
		t.Fatalf("unsupported job caused polling: claims %d -> %d", before, after)
	}
	t.Setenv("QUOREM_LOSSLESS_CASES", "true")
	t.Setenv("QUOREM_LOSSLESS_RESULT_WRITES", "true")
	engine := &retryWakeEngine{started: make(chan struct{}, 1)}
	ctx, cancel = context.WithCancel(context.Background())
	done = make(chan struct{})
	go func() { defer close(done); _ = New(counted).Run(ctx, engine) }()
	select {
	case <-engine.started:
	case <-time.After(2 * time.Second):
		cancel()
		<-done
		t.Fatal("capable runner missed job")
	}
	cancel()
	<-done
}

type expiryAfterScanStore struct {
	*postgres.Store
	jobID   string
	expired bool
}

func (s *expiryAfterScanStore) NextExpiredAttempt(ctx context.Context, resumable bool, scope string) (string, error) {
	attempt, err := s.Store.NextExpiredAttempt(ctx, resumable, scope)
	if err == nil && !s.expired {
		s.expired = true
		_, err = s.Pool.Exec(ctx, `UPDATE execution_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1`, s.jobID)
	}
	return attempt, err
}
func TestLeaseExpiryBetweenScanAndClaimRequiresNextTeardown(t *testing.T) {
	store := executionWakeStore(t)
	wakeAdmission(t, store, "alice")
	ctx := context.Background()
	old, err := store.ClaimAfterTeardown(ctx, false, "", "test-scope")
	if err != nil || old.JobID == "" {
		t.Fatal(old, err)
	}
	repo := &expiryAfterScanStore{Store: store, jobID: old.JobID}
	engine := &deadlineReapEngine{reaped: make(chan string, 1), started: make(chan execution.Job, 1)}
	service := New(repo)
	more, err := service.claimOnce(ctx, engine)
	if err != nil || more {
		t.Fatalf("reclaimed without scan: %t %v", more, err)
	}
	select {
	case <-engine.started:
		t.Fatal("executed without teardown")
	default:
	}
	more, err = service.claimOnce(ctx, engine)
	if err != nil || !more {
		t.Fatalf("confirmed reclaim: %t %v", more, err)
	}
	if got := <-engine.reaped; got != old.AttemptID {
		t.Fatal("wrong attempt reaped", got)
	}
	if got := <-engine.started; got.AttemptID == old.AttemptID {
		t.Fatal("stale attempt reused")
	}
}
