package worker

import (
	"context"
	"errors"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/ethan-ngai/quorem/internal/delivery"
	"github.com/ethan-ngai/quorem/internal/execution"
	"log"
	"sync"
	"time"
)

// Aliases expose runner inputs without exposing API persistence packages.
type Spec = judging.Spec
type Case = problems.Case
type Parameter = problems.Parameter
type Fixture = problems.Fixture

func NormalizeCaseOutput(f Fixture, c Case, value []byte) ([]byte, error) {
	return problems.NormalizeCaseOutput(f.Problem, c, value)
}
func CaseExpected(f Fixture, c Case) []byte { return problems.CaseExpected(f.Problem, c) }
func MethodSignatures(f Fixture) any        { return problems.OdysseyMethods(f.Problem) }

func Normalize(typ string, value []byte) ([]byte, error) { return problems.Normalize(typ, value) }
func LoadFixtures(dir string) ([]Fixture, error)         { return problems.LoadFixtures(dir) }

var ErrTeardown = errors.New("sandbox teardown unconfirmed")

type attemptReaper interface {
	TeardownAttempt(context.Context, string) error
}

// Repository owns atomic claims, leases, fencing, and durable completion.
type Repository interface {
	LoadExecution(context.Context, execution.Job) (Spec, error)
	ReconcileBackground(context.Context) error
	ExpiredAttempts(context.Context) ([]string, error)
	Claim(context.Context) (execution.Job, error)
	Lease(context.Context, execution.Job, bool) (bool, error)
	Complete(context.Context, execution.Job, execution.Completion) error
}
type Service struct {
	store         Repository
	queue         delivery.Queue
	close         func()
	admissionWake chan struct{}
	cancelMu      sync.Mutex
	cancelHub     *cancellationHub
}
type Option func(*Service)

func WithQueue(queue delivery.Queue) Option { return func(s *Service) { s.queue = queue } }
func New(store Repository, options ...Option) *Service {
	s := &Service{store: store, admissionWake: make(chan struct{}, 1)}
	for _, option := range options {
		option(s)
	}
	return s
}
func (s *Service) Close() {
	s.closeCancellations()
	if s.close != nil {
		s.close()
	}
}
func (s *Service) Load(ctx context.Context, j execution.Job) (Spec, error) {
	return s.store.LoadExecution(ctx, j)
}
func (s *Service) Run(ctx context.Context, engine execution.ExecutionEngine) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	interval := 5 * time.Second
	wake := make(chan struct{}, 1)
	consumerDone := make(chan struct{})
	if s.queue != nil {
		interval = 5 * time.Second
		go func() { defer close(consumerDone); s.consume(ctx, wake) }()
		defer func() { cancel(); <-consumerDone }()
	}
	var databaseWake <-chan struct{}
	var stopDatabase func()
	connect := func() {
		if repo, ok := s.store.(executionNotifications); ok {
			var err error
			databaseWake, stopDatabase, err = repo.ExecutionNotifications(ctx)
			if err != nil {
				databaseWake = nil
				log.Print("Execution notifications unavailable; recovery polling active")
			}
		}
	}
	connect()
	defer func() {
		if stopDatabase != nil {
			stopDatabase()
		}
	}()
	// Subscribe before the initial claim so commits cannot fall into a startup gap.
	select {
	case wake <- struct{}{}:
	default:
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			if databaseWake == nil {
				connect()
			}
		case <-wake:
		case _, open := <-databaseWake:
			if !open {
				if stopDatabase != nil {
					stopDatabase()
					stopDatabase = nil
				}
				databaseWake = nil
				continue
			}
		}
		if err := s.store.ReconcileBackground(ctx); err != nil {
			log.Print("Match reconciliation unavailable")
			continue
		}
		// A coalesced wake may represent a full batch; drain durable claims in this slot.
		for ctx.Err() == nil && s.poll(ctx, engine) {
		}
	}
}
func (s *Service) consume(ctx context.Context, wake chan<- struct{}) {
	for ctx.Err() == nil {
		messages, err := s.queue.Receive(ctx, delivery.MaxBatch)
		if err != nil {
			log.Print("Queue notification receive unavailable")
		}
		// One wake drains a batch; notification IDs never confer job ownership.
		if len(messages) > 0 {
			select {
			case wake <- struct{}{}:
			default:
			}
		}
		for _, message := range messages {
			if err := s.queue.Ack(ctx, message.Receipt); err != nil {
				log.Print("Queue notification acknowledgment unavailable")
			}
		}
		// Cloudflare uses short polling; bound empty/error loops for both adapters.
		timer := time.NewTimer(time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}
func (s *Service) poll(ctx context.Context, engine execution.ExecutionEngine) bool {
	more, err := s.pollOnce(ctx, engine)
	if err != nil {
		log.Print("Execution polling unavailable")
	}
	return more && err == nil
}
func (s *Service) pollOnce(ctx context.Context, engine execution.ExecutionEngine) (bool, error) {
	attempts, e := s.store.ExpiredAttempts(ctx)
	if e != nil {
		return false, e
	}
	for _, attempt := range attempts {
		reaper, ok := engine.(attemptReaper)
		if !ok {
			return false, ErrTeardown
		}
		if err := reaper.TeardownAttempt(ctx, attempt); err != nil {
			return false, err
		}
	}
	claimStarted := time.Now()
	job, err := s.store.Claim(ctx)
	if err != nil {
		return false, err
	}
	if job.JobID == "" {
		return false, nil
	}
	return true, s.execute(ctx, engine, job, time.Since(claimStarted))
}
func (s *Service) execute(parent context.Context, engine execution.ExecutionEngine, j execution.Job, claimDuration time.Duration) error {
	started := time.Now()
	language := "unknown"
	if runtime, ok := execution.RuntimeForRevision(j.RuntimeRevision, j.HarnessRevision); ok {
		language = runtime.Language
	}
	var executeDuration, completeDuration time.Duration
	cases, samples := 0, 0
	outcome := "teardown_unconfirmed"
	// Aggregate timings only: source, case values, diagnostics and actor/job IDs stay private.
	defer func() {
		log.Printf("Judge execution timing language=%s claim_ms=%d execute_ms=%d complete_ms=%d total_ms=%d cases=%d samples=%d outcome=%s", language, claimDuration.Milliseconds(), executeDuration.Milliseconds(), completeDuration.Milliseconds(), (time.Since(started) + claimDuration).Milliseconds(), cases, samples, outcome)
	}()
	ctx, cancel := context.WithTimeout(parent, 120*time.Second)
	defer cancel()
	notifications, release, watchErr := s.subscribeCancellation(ctx, j.SubmissionID)
	if release != nil {
		defer release()
	}
	done := make(chan struct{})
	watchDone := make(chan struct{})
	var completion execution.Completion
	var err error
	if watchErr != nil {
		err = watchErr
		close(watchDone)
	} else {
		alive, leaseErr := s.store.Lease(ctx, j, false)
		if leaseErr != nil || !alive {
			err = errors.New("execution lease unavailable")
			close(watchDone)
		} else {
			go func() {
				defer close(watchDone)
				ticker := time.NewTicker(15 * time.Second)
				defer ticker.Stop()
				for {
					select {
					case <-done:
						return
					case <-ctx.Done():
						return
					case _, open := <-notifications:
						if !open {
							cancel()
							return
						}
						alive, err := s.store.Lease(ctx, j, false)
						if err != nil || !alive {
							cancel()
							return
						}
					case <-ticker.C:
						alive, err := s.store.Lease(ctx, j, true)
						if err != nil || !alive {
							cancel()
							return
						}
					}
				}
			}()
			executeStarted := time.Now()
			completion, err = engine.Execute(ctx, j)
			executeDuration = time.Since(executeStarted)
		}
	}
	cases = len(completion.HiddenCases) + len(completion.PublicCaseResults)
	samples = len(completion.SubmitSampleResults)
	close(done)
	<-watchDone
	if errors.Is(err, ErrTeardown) {
		return err
	}
	outcome = "completed"
	if err != nil {
		outcome = "engine_unavailable"
		completion = execution.Completion{SubmissionID: j.SubmissionID, AttemptID: j.AttemptID, EngineFailure: "Execution engine unavailable"}
	}
	// Engine returns only after teardown, so cancellation may release the owner slot now.
	finalCtx, finalCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer finalCancel()
	completeStarted := time.Now()
	if err = s.store.Complete(finalCtx, j, completion); err != nil {
		outcome = "completion_unavailable"
		log.Print("Queue completion unavailable")
	}
	completeDuration = time.Since(completeStarted)
	return err
}
