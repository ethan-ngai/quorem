package postgres

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/internal/execution"
)

func TestInterviewSampleFallbackExecutionAndVisibility(t *testing.T) {
	for _, fallback := range []bool{true, false} {
		t.Run(map[bool]string{true: "no private cases", false: "equal private case"}[fallback], func(t *testing.T) {
			s := interviewTestStore(t)
			ctx := context.Background()
			q := customInterviewQuestion()
			if fallback {
				q.Custom.PrivateCases = nil
			} else {
				q.Custom.PrivateCases = q.Custom.PublicCases
			}
			room, err := s.CreateInterview(ctx, "alice", ID(), interviews.Create{Title: "Sample fallback", Question: q})
			if err != nil {
				t.Fatal(err)
			}
			if _, err = s.JoinInterview(ctx, "bob", strings.TrimPrefix(room.InvitePath, "/interview-invite/"), "", ""); err != nil {
				t.Fatal(err)
			}
			submission, err := admitInterviewForTest(s, ctx, "bob", room.ID, ID(), "submit", nil)
			if err != nil {
				t.Fatal(err)
			}
			job, err := s.Claim(ctx)
			if err != nil || job.SubmissionID != submission.ID {
				t.Fatal(job, err)
			}
			spec, err := s.LoadExecution(ctx, job)
			if err != nil || spec.SubmitCasesAreSamples != fallback || len(spec.Cases) != 1 || len(spec.SubmitSamples) != 1 {
				t.Fatal(spec, err)
			}
			detail := []execution.PublicCaseResult{{Index: 0, Status: "accepted", Actual: json.RawMessage(`2`), Expected: json.RawMessage(`2`), Stdout: "output", Stderr: "note"}}
			completion := execution.Completion{SubmissionID: job.SubmissionID, AttemptID: job.AttemptID, Verdict: execution.Accepted, Score: &execution.Score{Passed: 1, Total: 1}, HiddenCases: []execution.HiddenCaseResult{{Index: 0, Status: execution.Accepted}}, PrivateCaseResults: detail, SubmitSampleResults: detail}
			if err = s.Complete(ctx, job, completion); err != nil {
				t.Fatal(err)
			}
			owner, err := s.Submission(ctx, "bob", submission.ID)
			if err != nil || len(owner.PublicCases) != 1 || len(owner.PrivateCaseResults) != 0 {
				t.Fatal(owner, err)
			}
			for _, user := range []string{"alice", "bob"} {
				result, err := s.InterviewSubmission(ctx, user, room.ID, submission.ID)
				if err != nil || len(result.PublicCases) != 1 {
					t.Fatal(user, result, err)
				}
				expected := 1
				if user == "bob" && !fallback {
					expected = 0
				}
				if len(result.PrivateCaseResults) != expected {
					t.Fatal(user, result.PrivateCaseResults)
				}
				if expected == 1 && (result.PrivateCaseResults[0].Stdout != "output" || result.PrivateCaseResults[0].Stderr != "note") {
					t.Fatal(user, result.PrivateCaseResults)
				}
			}
		})
	}
}
