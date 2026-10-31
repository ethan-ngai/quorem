package postgres

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/ethan-ngai/quorem/internal/execution"
)

func TestExecutionNotifyIsCommitDrivenAndDedicated(t *testing.T) {
	store := testStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	wake, stop, err := store.ExecutionNotifications(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer stop()
	if store.Pool.Stat().AcquiredConns() != 0 {
		t.Fatal("listener consumed pooled request connection")
	}
	problem, err := store.Problem(ctx, "run-widths", false)
	if err != nil {
		t.Fatal(err)
	}
	workspace, err := store.CreateWorkspace(ctx, "alice", problem.ID, "python")
	if err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	admitted, err := store.Admit(ctx, "alice", ID(), judging.Command{WorkspaceID: workspace.ID, Kind: "run", Source: "class Solution: pass"}, "notify-fixture")
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-wake:
		if time.Since(started) > time.Second {
			t.Fatal("commit wake waited for recovery tick")
		}
	case <-time.After(time.Second):
		t.Fatal("admission did not notify")
	}
	tx, err := store.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, "UPDATE execution_jobs SET available_at=clock_timestamp() WHERE submission_id=$1", admitted.ID); err != nil {
		t.Fatal(err)
	}
	select {
	case <-wake:
		t.Fatal("notification escaped before commit")
	case <-time.After(50 * time.Millisecond):
	}
	if err = tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case <-wake:
		t.Fatal("rolled-back retry notified")
	case <-time.After(50 * time.Millisecond):
	}
	queued, running, err := store.ExecutionQueueState(ctx)
	if err != nil || queued != 1 || running != 0 {
		t.Fatalf("state=%d/%d err=%v", queued, running, err)
	}
	stop()
	select {
	case _, open := <-wake:
		if open {
			t.Fatal("unexpected notification after cancellation")
		}
	case <-time.After(time.Second):
		t.Fatal("listener leaked")
	}
}

func TestRunnerOpenDoesNotLoadInvitationSecrets(t *testing.T) {
	url := os.Getenv("QUOREM_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("disposable PostgreSQL required")
	}
	t.Setenv("QUOREM_INVITE_KEY", "intentionally-invalid-api-only-key")
	store, err := OpenRunner(context.Background(), url)
	if err != nil {
		t.Fatal("runner unexpectedly required API invitation configuration")
	}
	store.Pool.Close()
}

func TestRunnableDeadlineMatchesClaimCapabilities(t *testing.T) {
	for _, origin := range []string{"submission", "version", "interview"} {
		t.Run(origin, func(t *testing.T) {
			t.Setenv("QUOREM_LOSSLESS_CASES", "true")
			t.Setenv("QUOREM_LOSSLESS_RESULT_WRITES", "true")
			s := interviewTestStore(t)
			ctx := context.Background()
			p, err := s.Problem(ctx, "mirror-letters", false)
			if err != nil {
				t.Fatal(err)
			}
			if origin != "submission" {
				f := copyProblemFixture(t, s, p.ID)
				f.HiddenCases[0].Args = []json.RawMessage{json.RawMessage(`"x\u0000y"`)}
				insertTestProblem(t, s, f)
				p = f.Problem
			}
			var sub judging.Submission
			if origin == "interview" {
				room, e := s.CreateInterview(ctx, "alice", ID(), interviews.Create{Title: "deadline", Question: interviews.QuestionInput{ProblemVersionID: p.ID, Language: "python"}})
				if e != nil {
					t.Fatal(e)
				}
				sub, err = admitInterviewForTest(s, ctx, "alice", room.ID, ID(), "run", nil)
			} else {
				w, e := s.CreateWorkspace(ctx, "alice", p.ID, "python")
				if e != nil {
					t.Fatal(e)
				}
				command := judging.Command{WorkspaceID: w.ID, Kind: "run", Source: "source"}
				if origin == "submission" {
					command.CustomCases = []problems.Case{{Args: []json.RawMessage{json.RawMessage(`"x\u0000y"`)}}}
				}
				sub, err = s.Admit(ctx, "alice", ID(), command, ID())
			}
			if err != nil {
				t.Fatal(err)
			}
			var jobID string
			if err = s.Pool.QueryRow(ctx, `SELECT id FROM execution_jobs WHERE submission_id=$1`, sub.ID).Scan(&jobID); err != nil {
				t.Fatal(err)
			}
			var submissionSidecar, versionSidecar, interviewSidecar bool
			err = s.Pool.QueryRow(ctx, `SELECT s.lossless_cases IS NOT NULL, COALESCE(p.lossless_fixture IS NOT NULL,false), COALESCE(q.lossless_fixture IS NOT NULL,false) FROM submissions s LEFT JOIN workspaces w ON w.id=s.workspace_id LEFT JOIN problem_versions p ON p.id=w.problem_version_id LEFT JOIN interview_execution ie ON ie.submission_id=s.id LEFT JOIN interview_question_snapshots q ON q.session_id=ie.session_id AND q.id=ie.fixture_id WHERE s.id=$1`, sub.ID).Scan(&submissionSidecar, &versionSidecar, &interviewSidecar)
			if err != nil || submissionSidecar != (origin == "submission") || versionSidecar != (origin == "version") || interviewSidecar != (origin == "interview") {
				t.Fatalf("unexpected sidecars: submission=%t version=%t interview=%t err=%v", submissionSidecar, versionSidecar, interviewSidecar, err)
			}
			for _, checkpoint := range []bool{false, true} {
				for _, cancelled := range []bool{false, true} {
					for _, resumable := range []bool{false, true} {
						for _, flags := range [][2]string{{"false", "false"}, {"true", "false"}, {"false", "true"}, {"true", "true"}} {
							t.Setenv("QUOREM_LOSSLESS_CASES", flags[0])
							t.Setenv("QUOREM_LOSSLESS_RESULT_WRITES", flags[1])
							if _, err = s.Pool.Exec(ctx, `UPDATE submissions SET state='queued',cancel_requested=$2 WHERE id=$1`, sub.ID, cancelled); err != nil {
								t.Fatal(err)
							}
							if _, err = s.Pool.Exec(ctx, `UPDATE execution_jobs SET finished=false,attempt_id=NULL,lease_until=NULL,attempts=0,available_at=clock_timestamp() WHERE id=$1`, jobID); err != nil {
								t.Fatal(err)
							}
							if _, err = s.Pool.Exec(ctx, `DELETE FROM execution_checkpoints WHERE job_id=$1`, jobID); err != nil {
								t.Fatal(err)
							}
							if checkpoint {
								if _, err = s.Pool.Exec(ctx, `INSERT INTO execution_checkpoints(job_id) VALUES($1)`, jobID); err != nil {
									t.Fatal(err)
								}
							}
							want := (!checkpoint || resumable) && flags[0] == "true" && flags[1] == "true"
							_, present, e := s.NextRunnableExecutionDeadline(ctx, resumable, "")
							if e != nil || present != want {
								t.Fatalf("%s checkpoint=%t cancelled=%t resumable=%t flags=%v deadline=%t want=%t err=%v", origin, checkpoint, cancelled, resumable, flags, present, want, e)
							}
							var job execution.Job
							if resumable {
								job, e = s.ClaimResumable(ctx)
							} else {
								job, e = s.Claim(ctx)
							}
							if e != nil {
								t.Fatal(e)
							}
							var finished bool
							if e = s.Pool.QueryRow(ctx, `SELECT finished FROM execution_jobs WHERE id=$1`, jobID).Scan(&finished); e != nil {
								t.Fatal(e)
							}
							if (job.JobID != "" || finished) != want || (job.JobID != "" && cancelled) {
								t.Fatalf("claim mismatch: checkpoint=%t cancelled=%t resumable=%t flags=%v job=%+v finished=%t", checkpoint, cancelled, resumable, flags, job, finished)
							}
						}
					}
				}
			}
		})
	}
}

func TestRunnableDeadlineSkipsUnsupportedEarlierJob(t *testing.T) {
	t.Setenv("QUOREM_LOSSLESS_CASES", "true")
	t.Setenv("QUOREM_LOSSLESS_RESULT_WRITES", "true")
	s := testStore(t)
	ctx := context.Background()
	p, err := s.Problem(ctx, "mirror-letters", false)
	if err != nil {
		t.Fatal(err)
	}
	alice, err := s.CreateWorkspace(ctx, "alice", p.ID, "python")
	if err != nil {
		t.Fatal(err)
	}
	blocked, err := s.Admit(ctx, "alice", ID(), judging.Command{WorkspaceID: alice.ID, Kind: "run", Source: "source", CustomCases: []problems.Case{{Args: []json.RawMessage{json.RawMessage(`"x\u0000y"`)}}}}, ID())
	if err != nil {
		t.Fatal(err)
	}
	bob, err := s.CreateWorkspace(ctx, "bob", p.ID, "python")
	if err != nil {
		t.Fatal(err)
	}
	delayed, err := s.Admit(ctx, "bob", ID(), judging.Command{WorkspaceID: bob.ID, Kind: "run", Source: "source"}, ID())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE execution_jobs SET available_at=clock_timestamp()+interval '5 seconds' WHERE submission_id=$1`, delayed.ID); err != nil {
		t.Fatal(err)
	}
	t.Setenv("QUOREM_LOSSLESS_CASES", "false")
	delay, present, err := s.NextRunnableExecutionDeadline(ctx, false, "")
	if err != nil || !present || delay < 3*time.Second || delay > 5*time.Second {
		t.Fatalf("ordinary deadline: %s %t %v", delay, present, err)
	}
	job, err := s.Claim(ctx)
	if err != nil || job.JobID != "" {
		t.Fatalf("claimed before ordinary deadline: %+v %v", job, err)
	}
	t.Setenv("QUOREM_LOSSLESS_CASES", "true")
	delay, present, err = s.NextRunnableExecutionDeadline(ctx, false, "")
	if err != nil || !present || delay != 0 {
		t.Fatalf("lossless deadline: %s %t %v", delay, present, err)
	}
	job, err = s.Claim(ctx)
	if err != nil || job.SubmissionID != blocked.ID {
		t.Fatalf("capable claim: %+v %v", job, err)
	}
	if err = s.Complete(ctx, job, execution.Completion{SubmissionID: job.SubmissionID, AttemptID: job.AttemptID, Verdict: execution.Accepted}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("QUOREM_LOSSLESS_CASES", "false")
	if _, err = s.Pool.Exec(ctx, `UPDATE execution_jobs SET available_at=clock_timestamp()-interval '1 second' WHERE submission_id=$1`, delayed.ID); err != nil {
		t.Fatal(err)
	}
	job, err = s.Claim(ctx)
	if err != nil || job.SubmissionID != delayed.ID {
		t.Fatalf("ordinary claim: %+v %v", job, err)
	}
}
