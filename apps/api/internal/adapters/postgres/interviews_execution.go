package postgres

import (
	"context"
	"encoding/json"

	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/jackc/pgx/v5"
)

// Interview admission snapshots persisted source under its document lock; private fixtures remain owner-scoped.
func (s *Store) AdmitInterview(ctx context.Context, user, id, key string, command interviews.ExecutionCommand) (judging.Submission, error) {
	var out judging.Submission
	kind, customCases := command.Kind, command.CustomCases
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

	hash := interviewFingerprint(id+":submission", command)
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
	if command.QuestionEpoch != v.snapshot.QuestionEpoch {
		return out, failure("document_changed", 409, "Question changed; open its current document")
	}
	if command.DocumentEpoch != v.snapshot.Document.Epoch || command.SourceHash != Hash([]byte(v.snapshot.Document.Source)) {
		return out, failure("document_changed", 409, "Document changed; synchronize and retry")
	}
	level := 1
	var progressScope any
	if v.fixture.Problem.Odyssey != nil {
		level, _, err = interviewProgress(ctx, tx, v)
		if err != nil {
			return out, err
		}
		progressScope = v.snapshot.QuestionEpoch
		if _, err = tx.Exec(ctx, `INSERT INTO odyssey_progress(scope_id,problem_version_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, progressScope, v.fixture.Problem.ID); err != nil {
			return out, err
		}
	}
	cases, err := executionCases(&v.fixture, level, kind, customCases, true)
	if err != nil {
		return out, err
	}
	if _, err = ownerExecutionAdmission(ctx, tx, user); err != nil {
		return out, err
	}
	if guest {
		available, e := guestSponsorCapacity(ctx, tx, v.snapshot.HostID)
		if e != nil {
			return out, e
		}
		if !available {
			return out, failure("quota_exceeded", 429, "Host guest execution capacity reached")
		}
	}
	if err = executionQueueAdmission(ctx, tx); err != nil {
		return out, err
	}
	submissionID, jobID := ID(), ID()
	encoded, _ := json.Marshal(cases)
	if _, err = tx.Exec(ctx, `INSERT INTO submissions(id,owner_id,interview_id,kind,source,source_hash,state,cases,custom_run) VALUES($1,$2,$3,$4,$5,$6,'queued',$7,$8)`, submissionID, user, id, kind, v.snapshot.Document.Source, Hash([]byte(v.snapshot.Document.Source)), encoded, customCases != nil); err != nil {
		return out, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO execution_jobs(id,submission_id,language,runtime_revision,harness_revision) VALUES($1,$2,$3,$4,$5)`, jobID, submissionID, v.language, v.fixture.Problem.RuntimeRevision, v.fixture.HarnessRevision); err != nil {
		return out, err
	}
	fixture, err := json.Marshal(v.fixture)
	if err != nil {
		return out, err
	}
	fixtureID, err := saveInterviewFixture(ctx, tx, id, fixture)
	if err != nil {
		return out, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO interview_execution(submission_id,session_id,document_version,document_epoch,fixture_id,level,progress_scope,question_epoch) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, submissionID, id, v.snapshot.Document.Version, v.snapshot.Document.Epoch, fixtureID, level, progressScope, v.snapshot.QuestionEpoch); err != nil {
		return out, err
	}
	if _, err = tx.Exec(ctx, `UPDATE users SET admission_tokens=`+executionTokenBalance+`-1,tokens_updated_at=clock_timestamp() WHERE id=$1`, user); err != nil {
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
func (s *Store) InterviewSubmission(ctx context.Context, user, id, submissionID string) (judging.Submission, error) {
	var out judging.Submission
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return out, err
	}
	defer tx.Rollback(ctx)
	v, err := loadInterview(ctx, tx, user, id, false, false, false)
	if err != nil {
		return out, err
	}
	var submitter string
	if err = tx.QueryRow(ctx, `SELECT s.owner_id FROM submissions s JOIN interview_execution e ON e.submission_id=s.id WHERE e.session_id=$1 AND s.id=$2`, uuidLookup(id), uuidLookup(submissionID)).Scan(&submitter); err == pgx.ErrNoRows {
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
		out.Diagnostics = nil
	}
	return out, err
}
