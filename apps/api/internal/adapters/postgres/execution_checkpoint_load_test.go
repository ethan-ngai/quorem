package postgres

import (
	"context"
	"encoding/json"
	"math/rand"
	"os"
	"runtime"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/internal/execution"
)

// Opt-in disposable-database measurement of the legal maximum case count and output limits.
func TestCheckpointLargeReplayMeasurement(t *testing.T) {
	if os.Getenv("QUOREM_TEST_CHECKPOINT_LOAD") != "1" {
		t.Skip("set QUOREM_TEST_CHECKPOINT_LOAD=1")
	}
	s := testStore(t)
	ctx := context.Background()
	p, err := s.Problem(ctx, "run-widths", false)
	if err != nil {
		t.Fatal(err)
	}
	w, err := s.CreateWorkspace(ctx, "alice", p.ID, "python")
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.Admit(ctx, "alice", ID(), judging.Command{WorkspaceID: w.ID, Kind: "run", Source: "source"}, ID())
	if err != nil {
		t.Fatal(err)
	}
	job, err := s.Claim(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// Model maximum stdout/stderr with high-entropy ASCII controls and a 64 KiB JSON value.
	random := rand.New(rand.NewSource(1))
	controls := make([]byte, 65536)
	for i := range controls {
		controls[i] = byte(random.Intn(32))
	}
	letters := make([]byte, 65530)
	for i := range letters {
		letters[i] = byte('a' + random.Intn(26))
	}
	frame, err := json.Marshal(struct {
		Status, Stdout, Stderr string
		Actual                 json.RawMessage
	}{"executed", string(controls), string(controls), json.RawMessage(`"` + string(letters) + `"`)})
	if err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	for i := 0; i < 320; i++ {
		if err = s.SaveCheckpoint(ctx, job, execution.CheckpointCase{Ordinal: i, Frame: frame}); err != nil {
			t.Fatal(i, err)
		}
	}
	saved := time.Since(started)
	var stored int64
	if err = s.Pool.QueryRow(ctx, `SELECT sum(octet_length(frame)) FROM execution_checkpoint_cases WHERE job_id=$1`, job.JobID).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	runtime.GC()
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	started = time.Now()
	seen := 0
	var outputs []execution.PublicCaseResult
	peak := before.HeapAlloc
	err = s.ReplayCheckpoint(ctx, job, 320, func(i int, raw json.RawMessage) error {
		seen++
		if i == 0 && string(raw) != string(frame) {
			t.Fatal("frame changed")
		}
		var output execution.PublicCaseResult
		if err := json.Unmarshal(raw, &output); err != nil {
			return err
		}
		outputs = append(outputs, output)
		if i%8 == 0 {
			var current runtime.MemStats
			runtime.ReadMemStats(&current)
			peak = max(peak, current.HeapAlloc)
		}
		return nil
	})
	replay := time.Since(started)
	runtime.ReadMemStats(&after)
	if err != nil || seen != 320 || len(outputs) != 320 {
		t.Fatal(seen, err)
	}
	t.Logf("320 frames: raw=%d bytes stored=%d bytes write=%s replay=%s heap_before=%d heap_after=%d peak_sampled=%d total_alloc=%d", len(frame)*320, stored, saved, replay, before.HeapAlloc, after.HeapAlloc, peak, after.TotalAlloc-before.TotalAlloc)
}
