package engine

import (
	"context"
	"github.com/ethan-ngai/quorem/apps/api/worker"
	"github.com/ethan-ngai/quorem/internal/execution"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestCompilationBudgetProducesContestantVerdict(t *testing.T) {
	dir := t.TempDir()
	script := "#!/bin/sh\nif [ \"$1\" = rm ]; then exit 0; fi\nprintf '\\000'\ncat >/dev/null\nsleep .08\nprintf '\\000'\nprintf '{\"status\":\"executed\",\"actual\":[]}'\n"
	if err := os.WriteFile(filepath.Join(dir, "docker"), []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	f := worker.Fixture{}
	f.Problem.Signature.ReturnType = "list<int>"
	f.HiddenCases = []worker.Case{{Expected: []byte("[]")}, {Expected: []byte("[]")}, {Expected: []byte("[]")}}
	runtime, _ := execution.LanguageRuntime("java")
	engine := &Docker{compilationLimit: 120 * time.Millisecond, Resolve: func(context.Context, execution.Job) (worker.Spec, error) {
		return worker.Spec{Kind: "submit", Fixture: f, Cases: f.HiddenCases}, nil
	}}
	result, err := engine.Execute(context.Background(), execution.Job{Language: "java", RuntimeRevision: runtime.Revision, HarnessRevision: runtime.Harness, Limits: execution.DefaultLimits()})
	if err != nil || result.Verdict != execution.TimeLimit || result.Score == nil || result.Score.Passed != 1 || result.Score.Total != 3 || len(result.HiddenCases) != 3 {
		t.Fatal(result, err)
	}
}
