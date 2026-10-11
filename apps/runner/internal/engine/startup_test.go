package engine

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/worker"
	"github.com/ethan-ngai/quorem/internal/execution"
)

func TestSandboxStartupDoesNotConsumeContestantBudget(t *testing.T) {
	for _, tc := range []struct {
		name, script, status string
		parentDeadline       bool
	}{
		{"slow startup", "sleep 0.3\nprintf '\\000'\ncat >/dev/null\nprintf '{\"status\":\"executed\",\"actual\":[]}'", "executed", false},
		{"slow contestant", "printf '\\000'\ncat >/dev/null\nexec sleep 1", "time_limit", false},
		{"cancel during startup", "exec sleep 1", "", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			// Replace Docker only in this process; exercise the actual framing and deadlines.
			script := "#!/bin/sh\nif [ \"$1\" = rm ]; then exit 0; fi\n" + tc.script + "\n"
			if err := os.WriteFile(filepath.Join(dir, "docker"), []byte(script), 0700); err != nil {
				t.Fatal(err)
			}
			t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
			limits := execution.DefaultLimits()
			limits.WallTimeMS = 100
			ctx := context.Background()
			if tc.parentDeadline {
				var cancel context.CancelFunc
				ctx, cancel = context.WithTimeout(ctx, 100*time.Millisecond)
				defer cancel()
			}
			frame, err := (&Docker{}).runCase(ctx, execution.Job{AttemptID: "startup-test", Limits: limits}, 0, worker.Spec{}, worker.Case{Args: []json.RawMessage{}})
			if tc.parentDeadline {
				if !errors.Is(err, context.DeadlineExceeded) {
					t.Fatal("parent cancellation became a contestant failure", frame, err)
				}
			} else if err != nil || frame.Status != tc.status {
				t.Fatal(frame, err)
			}
		})
	}
}
