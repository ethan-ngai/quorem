package postgres

import (
	"context"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/internal/execution"
)

func TestSubmitPublicSamplesDoNotChangeHiddenScore(t *testing.T) {
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
	sub, err := s.Admit(ctx, "alice", "samples-submit", judging.Command{WorkspaceID: w.ID, Kind: "submit", Source: "source"}, "samples")
	if err != nil {
		t.Fatal(err)
	}
	job, err := s.Claim(ctx)
	if err != nil || job.SubmissionID != sub.ID {
		t.Fatal(job, err)
	}
	spec, err := s.LoadExecution(ctx, job)
	if err != nil || len(spec.SubmitSamples) != len(p.Examples) {
		t.Fatal(spec, err)
	}
	completion := execution.Completion{SubmissionID: sub.ID, AttemptID: job.AttemptID, Verdict: execution.Accepted, Score: &execution.Score{Passed: len(spec.Cases), Total: len(spec.Cases)}}
	for i := range spec.Cases {
		completion.HiddenCases = append(completion.HiddenCases, execution.HiddenCaseResult{Index: i, Status: execution.Accepted})
	}
	for i := range spec.SubmitSamples {
		completion.SubmitSampleResults = append(completion.SubmitSampleResults, execution.PublicCaseResult{Index: i, Status: "accepted", Stdout: "public sample"})
	}
	incomplete := completion
	incomplete.SubmitSampleResults = append(append([]execution.PublicCaseResult{}, completion.SubmitSampleResults...), execution.PublicCaseResult{Index: len(spec.SubmitSamples)})
	if err = s.Complete(ctx, job, incomplete); err == nil {
		t.Fatal("accepted extra sample output")
	}
	if err = s.Complete(ctx, job, completion); err != nil {
		t.Fatal(err)
	}
	result, err := s.Submission(ctx, "alice", sub.ID)
	if err != nil || len(result.PublicCases) != len(spec.SubmitSamples) || result.PublicCases[0].Stdout != "public sample" || result.Score.Total != len(spec.Cases) || len(result.HiddenCases) != len(spec.Cases) {
		t.Fatal(result, err)
	}
}
