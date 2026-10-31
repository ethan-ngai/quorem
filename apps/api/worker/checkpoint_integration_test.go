package worker

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/internal/execution"
)

type yieldingEngine struct {
	service  *Service
	attempts int
}

func (e *yieldingEngine) SandboxScope(context.Context) (string, error) { return "test-scope", nil }

func (e *yieldingEngine) Execute(ctx context.Context, j execution.Job) (execution.Completion, error) {
	e.attempts++
	checkpoint, err := e.service.LoadCheckpoint(ctx, j)
	if err != nil {
		return execution.Completion{}, err
	}
	if checkpoint.NextOrdinal < 4 {
		err = e.service.SaveCheckpoint(ctx, j, execution.CheckpointCase{Ordinal: checkpoint.NextOrdinal, Frame: json.RawMessage(`{"status":"executed","actual":1}`)})
		if err != nil {
			return execution.Completion{}, err
		}
		return execution.Completion{}, ErrYield
	}
	return execution.Completion{SubmissionID: j.SubmissionID, AttemptID: j.AttemptID, Verdict: execution.Accepted}, nil
}

func TestPostgresDrainResumesMoreThanThreeChunks(t *testing.T) {
	store := executionWakeStore(t)
	wakeAdmission(t, store, "alice")
	service := New(store, WithResumable(true))
	engine := &yieldingEngine{service: service}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	state, done, err := service.drain(ctx, engine, 1, 100*time.Millisecond)
	if err != nil || !done || state.Queued != 0 || state.Running != 0 || engine.attempts != 5 {
		t.Fatalf("state=%+v done=%v attempts=%d err=%v", state, done, engine.attempts, err)
	}
	var status string
	var checkpoints int
	if err = store.Pool.QueryRow(ctx, `SELECT state,(SELECT count(*) FROM execution_checkpoints) FROM submissions WHERE owner_id='alice'`).Scan(&status, &checkpoints); err != nil || status != "completed" || checkpoints != 0 {
		t.Fatalf("state=%s checkpoints=%d err=%v", status, checkpoints, err)
	}
}
