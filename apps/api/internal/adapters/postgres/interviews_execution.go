package postgres

import (
	"context"
	"encoding/json"

	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/jackc/pgx/v5"
)

// Interview admission snapshots persisted source under its document lock; private fixtures never enter the catalog.
func (s *Store) AdmitInterview(ctx context.Context, user, id, key, kind string) (judging.Submission, error) {
	var out judging.Submission
	if kind != "run" && kind != "submit" {
		return out, failure("invalid_input", 400, "Choose run or submit")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return out, err
	}
	defer tx.Rollback(ctx)
	var guest bool
	if err = tx.QueryRow(ctx, `SELECT kind='guest' FROM users WHERE id=$1 AND NOT disabled FOR NO KEY UPDATE`, user).Scan(&guest); err != nil {
		return out, err
	}
	v, err := lockInterview(ctx, tx, user, id, false, true)
	if err != nil {
		return out, err
	}
	if err = requireInterviewOdyssey(ctx, tx, v.snapshot.HostID, v.fixture); err != nil {
		return out, err
	}
	hash := interviewFingerprint(id+":submission", kind)
	prior, data, err := priorInterviewOperation(ctx, tx, user, key, hash)
	if err != nil {
		return out, err
	}
	if prior != "" {
		var stored struct {
			SubmissionID string `json:"submissionId"`
		}
		if err = json.Unmarshal(data, &stored); err != nil {
			return out, err
		}
		return s.submission(ctx, tx, user, stored.SubmissionID)
	}
	cases := v.fixture.HiddenCases
	if kind == "run" || len(cases) == 0 {
		cases = v.fixture.Problem.SampleCases()
	}
	level := 1
	var progressScope any
	if v.fixture.Problem.Odyssey != nil {
		level, _, err = interviewProgress(ctx, tx, v)
		if err != nil {
			return out, err
		}
		var compiled problems.Problem
		compiled, cases, err = problems.CompileOdyssey(v.fixture, level, kind)
		v.fixture.Problem = compiled
		if err != nil {
			return out, err
		}
		progressScope = v.snapshot.QuestionEpoch
		if _, err = tx.Exec(ctx, `INSERT INTO odyssey_progress(scope_id,problem_version_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, progressScope, v.fixture.Problem.ID); err != nil {
			return out, err
		}
	}
	if len(cases) == 0 {
		return out, failure("invalid_input", 400, "No tests configured")
	}
	if err = interviewExecutionAdmission(ctx, tx, user, v.snapshot.HostID, guest); err != nil {
		return out, err
	}
	// Baseline workspace satisfies existing job FKs; the private immutable fixture lives only in interview_execution.
	var baseline string
	if err = tx.QueryRow(ctx, `SELECT v.id FROM problem_versions v JOIN problems p ON p.id=v.problem_id JOIN problem_languages l ON l.version_id=v.id AND l.language=$1 WHERE v.id=p.current_version_id ORDER BY v.id LIMIT 1`, v.language).Scan(&baseline); err != nil {
		return out, err
	}
	workspaceID := ID()
	if _, err = tx.Exec(ctx, `INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,problem_version_id,language) WHERE kind='solo' DO UPDATE SET owner_id=EXCLUDED.owner_id RETURNING id`, workspaceID, user, baseline, v.language); err != nil {
		return out, err
	}
	if err = tx.QueryRow(ctx, `SELECT id FROM workspaces WHERE owner_id=$1 AND problem_version_id=$2 AND language=$3 AND kind='solo'`, user, baseline, v.language).Scan(&workspaceID); err != nil {
		return out, err
	}
	submissionID, jobID := ID(), ID()
	encoded, _ := json.Marshal(cases)
	if _, err = tx.Exec(ctx, `INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) VALUES($1,$2,$3,$4,$5,$6,'queued',$7)`, submissionID, user, workspaceID, kind, v.snapshot.Document.Source, Hash([]byte(v.snapshot.Document.Source)), encoded); err != nil {
		return out, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO execution_jobs(id,submission_id,language,runtime_revision,harness_revision) VALUES($1,$2,$3,$4,$5)`, jobID, submissionID, v.language, v.fixture.Problem.RuntimeRevision, v.fixture.HarnessRevision); err != nil {
		return out, err
	}
	fixture, _ := json.Marshal(v.fixture)
	if _, err = tx.Exec(ctx, `INSERT INTO interview_execution(submission_id,session_id,document_version,document_epoch,fixture,level,progress_scope,question_epoch) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, submissionID, id, v.snapshot.Document.Version, v.snapshot.Document.Epoch, fixture, level, progressScope, v.snapshot.QuestionEpoch); err != nil {
		return out, err
	}
	if _, err = tx.Exec(ctx, `UPDATE users SET admission_tokens=LEAST(2,admission_tokens+EXTRACT(EPOCH FROM(clock_timestamp()-tokens_updated_at))/6.0)-1,tokens_updated_at=clock_timestamp() WHERE id=$1`, user); err != nil {
		return out, err
	}
	if err = saveInterviewOperation(ctx, tx, user, key, hash, id, map[string]string{"submissionId": submissionID}); err != nil {
		return out, err
	}
	if err = tx.Commit(ctx); err != nil {
		return out, err
	}
	out, err = s.Submission(ctx, user, submissionID)
	out.ExecutionJobID = jobID
	return out, err
}
func interviewExecutionAdmission(ctx context.Context, tx pgx.Tx, user, host string, guest bool) error {
	var busy bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM submissions WHERE owner_id=$1 AND state IN ('queued','running'))`, user).Scan(&busy); err != nil {
		return err
	}
	if busy {
		return failure("user_busy", 409, "Another execution is active")
	}
	var tokens float64
	var daily int
	if err := tx.QueryRow(ctx, `SELECT LEAST(2,admission_tokens+EXTRACT(EPOCH FROM(clock_timestamp()-tokens_updated_at))/6.0),(SELECT count(*) FROM submissions WHERE owner_id=$1 AND admitted_at>clock_timestamp()-interval '24 hours') FROM users WHERE id=$1`, user).Scan(&tokens, &daily); err != nil {
		return err
	}
	if tokens < 1 || daily >= 100 {
		return failure("quota_exceeded", 429, "Execution quota reached")
	}
	if guest {
		if _, err := tx.Exec(ctx, `INSERT INTO guest_sponsor_locks(user_id) VALUES($1) ON CONFLICT DO NOTHING`, host); err != nil {
			return err
		}
		var locked string
		if err := tx.QueryRow(ctx, `SELECT user_id FROM guest_sponsor_locks WHERE user_id=$1 FOR UPDATE`, host).Scan(&locked); err != nil {
			return err
		}
		caps, err := capabilities(ctx, tx, host)
		if err != nil {
			return err
		}
		var running int
		if running, err = activeGuestExecutions(ctx, tx, host); err != nil {
			return err
		}
		if running >= caps.GuestConcurrency {
			return failure("quota_exceeded", 429, "Host guest execution capacity reached")
		}
	}
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(740020)`); err != nil {
		return err
	}
	var pending int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM execution_jobs WHERE NOT finished`).Scan(&pending); err != nil {
		return err
	}
	if pending >= 200 {
		return failure("queue_saturated", 429, "Judge queue is full")
	}
	return nil
}
func (s *Store) InterviewSubmission(ctx context.Context, user, id, submissionID string) (judging.Submission, error) {
	var out judging.Submission
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return out, err
	}
	defer tx.Rollback(ctx)
	v, err := lockInterview(ctx, tx, user, id, false, false)
	if err != nil {
		return out, err
	}
	var submitter string
	if err = tx.QueryRow(ctx, `SELECT s.owner_id FROM submissions s JOIN interview_execution e ON e.submission_id=s.id WHERE e.session_id=$1 AND s.id::text=$2`, id, submissionID).Scan(&submitter); err == pgx.ErrNoRows {
		return out, failure("not_found", 404, "Execution unavailable")
	}
	if err != nil {
		return out, err
	}
	out, err = s.submission(ctx, tx, submitter, submissionID)
	if err == nil {
		err = s.projectInterviewResults(ctx, tx, v, submissionID, &out)
	}
	if v.snapshot.Role == "interviewee" && out.Kind == "submit" {
		out.HiddenCases = nil
		out.PublicCases = nil
		out.Diagnostics = nil
	}
	return out, err
}
