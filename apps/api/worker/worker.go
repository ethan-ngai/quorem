package worker

import (
	"context"
	"errors"
	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/postgres"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/ethan-ngai/quorem/internal/execution"
	"log"
	"time"
)

// Aliases expose runner inputs without exposing API persistence packages.
type Spec = judging.Spec
type Case = problems.Case
type Fixture = problems.Fixture

func Normalize(typ string, value []byte) ([]byte, error) { return problems.Normalize(typ, value) }
func LoadFixtures(dir string) ([]Fixture, error)         { return problems.LoadFixtures(dir) }

var ErrTeardown = errors.New("sandbox teardown unconfirmed")

type attemptReaper interface {
	TeardownAttempt(context.Context, string) error
}
type Service struct{ store *postgres.Store }

func Open(ctx context.Context, url string) (*Service, error) {
	store, err := postgres.Open(ctx, url)
	if err != nil {
		return nil, err
	}
	return &Service{store}, nil
}
func (s *Service) Close() { s.store.Pool.Close() }
func (s *Service) Load(ctx context.Context, j execution.Job) (Spec, error) {
	return s.store.LoadExecution(ctx, j)
}
func (s *Service) Run(ctx context.Context, engine execution.ExecutionEngine) error {
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			if e := s.store.ReconcileMatches(ctx); e != nil {
				log.Print("Match reconciliation unavailable")
			}
			attempts, e := s.store.ExpiredAttempts(ctx)
			if e != nil {
				log.Print("Queue reconciliation unavailable")
				continue
			}
			safe := true
			for _, attempt := range attempts {
				reaper, ok := engine.(attemptReaper)
				if !ok || reaper.TeardownAttempt(ctx, attempt) != nil {
					safe = false
					break
				}
			}
			if !safe {
				log.Print("Sandbox reconciliation unavailable")
				continue
			}
			job, err := s.store.Claim(ctx)
			if err != nil {
				log.Print("Queue claim unavailable")
				continue
			}
			if job.JobID == "" {
				continue
			}
			s.execute(ctx, engine, job)
		}
	}
}
func (s *Service) execute(parent context.Context, engine execution.ExecutionEngine, j execution.Job) {
	ctx, cancel := context.WithTimeout(parent, 120*time.Second)
	defer cancel()
	done := make(chan struct{})
	watchDone := make(chan struct{})
	go func() {
		defer close(watchDone)
		ticker := time.NewTicker(200 * time.Millisecond)
		defer ticker.Stop()
		heartbeat := time.Now()
		for {
			select {
			case <-done:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				beat := time.Since(heartbeat) >= 15*time.Second
				alive, err := s.store.Lease(ctx, j, beat)
				if err != nil || !alive {
					cancel()
					return
				}
				if beat {
					heartbeat = time.Now()
				}
			}
		}
	}()
	completion, err := engine.Execute(ctx, j)
	close(done)
	<-watchDone
	if errors.Is(err, ErrTeardown) {
		return
	}
	if err != nil {
		completion = execution.Completion{SubmissionID: j.SubmissionID, AttemptID: j.AttemptID, EngineFailure: "Execution engine unavailable"}
	}
	// Engine returns only after teardown, so cancellation may release the owner slot now.
	finalCtx, finalCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer finalCancel()
	if err = s.store.Complete(finalCtx, j, completion); err != nil {
		log.Print("Queue completion unavailable")
	}
}
