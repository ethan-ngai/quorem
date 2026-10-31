package postgres

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/ethan-ngai/quorem/internal/execution"
)

func TestInterviewSampleFallbackExecutionAndVisibility(t *testing.T) {
	for _, tc := range []struct {
		name            string
		fallback, empty bool
	}{
		{name: "null private cases", fallback: true},
		{name: "empty private cases", fallback: true, empty: true},
		{name: "equal private case"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fallback := tc.fallback
			s := interviewTestStore(t)
			ctx := context.Background()
			q := customInterviewQuestion()
			if fallback {
				q.Custom.PrivateCases = nil
				if tc.empty {
					q.Custom.PrivateCases = []problems.Case{}
				}
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
			if fallback {
				var shape string
				if err = s.Pool.QueryRow(ctx, `SELECT jsonb_typeof(q.fixture->'hiddenCases') FROM interview_execution e JOIN interview_question_snapshots q ON q.session_id=e.session_id AND q.id=e.fixture_id WHERE e.submission_id=$1`, submission.ID).Scan(&shape); err != nil {
					t.Fatal(err)
				}
				want := "null"
				if tc.empty {
					want = "array"
				}
				if shape != want {
					t.Fatalf("snapshot private cases: %s", shape)
				}
			}
			job, err := claimTestJob(ctx, s, false)
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
