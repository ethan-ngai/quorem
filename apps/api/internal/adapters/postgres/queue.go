package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/ethan-ngai/quorem/internal/execution"
	"github.com/jackc/pgx/v5"
)

func (s *Store) Claim(ctx context.Context) (execution.Job, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return execution.Job{}, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(740020)"); err != nil {
		return execution.Job{}, err
	}
	var j execution.Job
	var data []byte
	var cancelled bool
	var attempts int
	err = tx.QueryRow(ctx, `SELECT j.id,j.submission_id,w.problem_version_id,COALESCE(ie.fixture->'problem',p.public),s.cancel_requested,j.attempts,j.language,j.runtime_revision,j.harness_revision
 FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id JOIN workspaces w ON w.id=s.workspace_id JOIN problem_versions p ON p.id=w.problem_version_id LEFT JOIN interview_execution ie ON ie.submission_id=s.id
 WHERE NOT j.finished AND j.available_at<=clock_timestamp() AND (j.lease_until IS NULL OR j.lease_until<clock_timestamp()) AND s.state IN ('queued','running')
 ORDER BY j.available_at,j.id FOR UPDATE OF j,s SKIP LOCKED LIMIT 1`).Scan(&j.JobID, &j.SubmissionID, &j.ProblemVersionID, &data, &cancelled, &attempts, &j.Language, &j.RuntimeRevision, &j.HarnessRevision)
	if errors.Is(err, pgx.ErrNoRows) {
		return j, nil
	}
	if err != nil {
		return j, err
	}
	if cancelled {
		if _, err = tx.Exec(ctx, "UPDATE execution_jobs SET finished=true,attempt_id=NULL WHERE id=$1", j.JobID); err != nil {
			return j, err
		}
		if _, err = tx.Exec(ctx, "UPDATE submissions SET state='cancelled',updated_at=clock_timestamp() WHERE id=$1", j.SubmissionID); err != nil {
			return j, err
		}
		return execution.Job{}, tx.Commit(ctx)
	}
	if attempts >= 3 {
		encoded, _ := json.Marshal(judging.Submission{InfrastructureError: "Judge unavailable"})
		if _, err = tx.Exec(ctx, "UPDATE execution_jobs SET finished=true,attempt_id=NULL,lease_until=NULL WHERE id=$1", j.JobID); err != nil {
			return j, err
		}
		if _, err = tx.Exec(ctx, "UPDATE submissions SET state='failed',result=$2,updated_at=clock_timestamp() WHERE id=$1", j.SubmissionID, encoded); err != nil {
			return j, err
		}
		return execution.Job{}, tx.Commit(ctx)
	}
	var p problems.Problem
	if err = json.Unmarshal(data, &p); err != nil {
		return j, err
	}
	j.AttemptID = ID()
	j.SourceRef = j.SubmissionID
	j.SuiteRef = p.ID
	j.Limits = p.Limits
	if _, err = tx.Exec(ctx, "UPDATE execution_jobs SET attempt_id=$2,attempts=attempts+1,lease_until=clock_timestamp()+interval '90 seconds' WHERE id=$1", uuidLookup(j.JobID), uuidLookup(j.AttemptID)); err != nil {
		return j, err
	}
	if _, err = tx.Exec(ctx, "UPDATE submissions SET state='running',updated_at=clock_timestamp() WHERE id=$1", j.SubmissionID); err != nil {
		return j, err
	}
	return j, tx.Commit(ctx)
}
func (s *Store) LoadExecution(ctx context.Context, j execution.Job) (judging.Spec, error) {
	var spec judging.Spec
	var fixture, cases []byte
	err := s.Pool.QueryRow(ctx, `SELECT s.source,s.kind,COALESCE(ie.fixture,p.fixture),s.cases,ie.submission_id IS NOT NULL FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id JOIN workspaces w ON w.id=s.workspace_id JOIN problem_versions p ON p.id=w.problem_version_id LEFT JOIN interview_execution ie ON ie.submission_id=s.id WHERE j.id=$1 AND j.attempt_id=$2 AND j.lease_until>clock_timestamp() AND NOT j.finished`, uuidLookup(j.JobID), uuidLookup(j.AttemptID)).Scan(&spec.Source, &spec.Kind, &fixture, &cases, &spec.PrivateDetails)
	if err != nil {
		return spec, err
	}
	if err = json.Unmarshal(fixture, &spec.Fixture); err != nil {
		return spec, err
	}
	err = json.Unmarshal(cases, &spec.Cases)
	if err == nil && spec.Fixture.Problem.Odyssey != nil {
		var level *int
		if err = s.Pool.QueryRow(ctx, "SELECT odyssey_level FROM submissions WHERE id=$1", j.SubmissionID).Scan(&level); err != nil {
			return spec, err
		}
		if level != nil {
			spec.Fixture.Problem.Odyssey = &problems.Odyssey{Levels: spec.Fixture.Problem.Odyssey.Levels[:*level]}
		}
	}
	if err == nil && spec.Kind == "submit" {
		spec.SubmitSamples = submissionSamples(spec.Fixture.Problem)
	}
	return spec, err
}

func (s *Store) Lease(ctx context.Context, j execution.Job, heartbeat bool) (bool, error) {
	var cancelled bool
	query := `SELECT s.cancel_requested FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE j.id=$1 AND j.attempt_id=$2 AND NOT j.finished AND j.lease_until>clock_timestamp()`
	err := s.Pool.QueryRow(ctx, query, uuidLookup(j.JobID), uuidLookup(j.AttemptID)).Scan(&cancelled)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if cancelled {
		return false, nil
	}
	if heartbeat {
		tag, e := s.Pool.Exec(ctx, "UPDATE execution_jobs SET lease_until=clock_timestamp()+interval '90 seconds' WHERE id=$1 AND attempt_id=$2 AND NOT finished AND lease_until>clock_timestamp()", uuidLookup(j.JobID), uuidLookup(j.AttemptID))
		if e != nil {
			return false, e
		}
		return tag.RowsAffected() == 1, nil
	}
	return true, nil
}
func (s *Store) Complete(ctx context.Context, j execution.Job, c execution.Completion) error {
	if c.SubmissionID != j.SubmissionID || c.AttemptID != j.AttemptID {
		return errors.New("completion identity mismatch")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var matchID string
	if err = tx.QueryRow(ctx, "SELECT COALESCE(match_id::text,'') FROM submissions WHERE id=$1", j.SubmissionID).Scan(&matchID); err != nil {
		return err
	}
	var match matchRecord
	if matchID != "" {
		match, err = lockMatch(ctx, tx, matchID)
		if err != nil {
			return err
		}
	}
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(740020)"); err != nil {
		return err
	}
	var cancelled bool
	var kind string
	var attempts int
	err = tx.QueryRow(ctx, `SELECT s.cancel_requested,s.kind,j.attempts FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE j.id=$1 AND j.attempt_id=$2 AND NOT j.finished AND j.lease_until>clock_timestamp() AND s.state='running' FOR UPDATE OF j,s`, uuidLookup(j.JobID), uuidLookup(j.AttemptID)).Scan(&cancelled, &kind, &attempts)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	// Freeze an elapsed finalization window before a late verdict can resolve uncertainty.
	if matchID != "" {
		if err = s.reconcileMatch(ctx, tx, &match); err != nil {
			return err
		}
	}
	state := "completed"
	result := judging.Submission{}
	if cancelled {
		state = "cancelled"
	} else if c.EngineFailure != "" {
		if attempts < 3 {
			if _, err = tx.Exec(ctx, "UPDATE execution_jobs SET attempt_id=NULL,lease_until=NULL,available_at=clock_timestamp()+interval '1 second' WHERE id=$1", j.JobID); err != nil {
				return err
			}
			if _, err = tx.Exec(ctx, "UPDATE submissions SET state='queued',updated_at=clock_timestamp() WHERE id=$1", j.SubmissionID); err != nil {
				return err
			}
			return tx.Commit(ctx)
		}
		state = "failed"
		result.InfrastructureError = "Judge unavailable"
	} else {
		result.Verdict = c.Verdict
		result.Diagnostics = c.SafeDiagnostics
		if kind == "submit" {
			var admittedCount int
			if err = tx.QueryRow(ctx, "SELECT jsonb_array_length(cases) FROM submissions WHERE id=$1", j.SubmissionID).Scan(&admittedCount); err != nil {
				return err
			}
			if c.Score == nil || c.Score.Total != admittedCount || c.Score.Passed < 0 || c.Score.Passed > admittedCount {
				return errors.New("incomplete hidden score")
			}
			if err = validateHiddenCases(c); err != nil {
				return err
			}
			result.Score = c.Score
			result.HiddenCases = c.HiddenCases
			result.Diagnostics = nil
			if len(c.SubmitSampleResults) > 0 {
				if err = validateSubmitSamples(ctx, tx, j, c.SubmitSampleResults); err != nil {
					return err
				}
				result.PublicCases = c.SubmitSampleResults
			}
		} else {
			result.PublicCases = c.PublicCaseResults
		}
	}
	if state == "completed" && kind == "submit" && result.Verdict == execution.Accepted && result.Score != nil && result.Score.Passed == result.Score.Total {
		if err = s.advanceOdyssey(ctx, tx, j.SubmissionID); err != nil {
			return err
		}
	}
	if state == "completed" && kind == "submit" && len(c.PrivateCaseResults) > 0 {
		var admitted int
		if err = tx.QueryRow(ctx, `SELECT jsonb_array_length(cases) FROM submissions WHERE id=$1`, j.SubmissionID).Scan(&admitted); err != nil {
			return err
		}
		if len(c.PrivateCaseResults) != admitted {
			return errors.New("incomplete private case details")
		}
		for i, r := range c.PrivateCaseResults {
			if r.Index != i || len(r.Stdout) > j.Limits.OutputBytes || len(r.Stderr) > j.Limits.OutputBytes || len(r.Actual) > j.Limits.OutputBytes {
				return errors.New("invalid private case details")
			}
		}
		private, _ := json.Marshal(c.PrivateCaseResults)
		if _, err = tx.Exec(ctx, `UPDATE interview_execution SET private_results=$2 WHERE submission_id=$1`, j.SubmissionID, private); err != nil {
			return err
		}
	}
	encoded, _ := json.Marshal(result)
	if _, err = tx.Exec(ctx, "UPDATE submissions SET state=$2,result=$3,updated_at=clock_timestamp() WHERE id=$1", j.SubmissionID, state, encoded); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "UPDATE execution_jobs SET finished=true,lease_until=NULL WHERE id=$1", j.JobID); err != nil {
		return err
	}
	payload, _ := json.Marshal(map[string]string{"submissionId": j.SubmissionID, "state": state})
	if _, err = tx.Exec(ctx, "INSERT INTO outbox_events(id,aggregate_id,type,payload) VALUES($1,$2,'submission.updated',$3)", ID(), j.SubmissionID, payload); err != nil {
		return err
	}
	if matchID != "" {
		if err = s.reconcileMatch(ctx, tx, &match); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) ExpiredAttempts(ctx context.Context) ([]string, error) {
	rows, err := s.Pool.Query(ctx, "SELECT attempt_id FROM execution_jobs WHERE NOT finished AND attempt_id IS NOT NULL AND lease_until<clock_timestamp()")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	attempts := []string{}
	for rows.Next() {
		var attempt string
		if err = rows.Scan(&attempt); err != nil {
			return nil, err
		}
		attempts = append(attempts, attempt)
	}
	return attempts, rows.Err()
}

func validateHiddenCases(c execution.Completion) error {
	// Older in-flight runners may complete without per-case statuses.
	if c.HiddenCases == nil {
		return nil
	}
	if c.Score == nil || len(c.HiddenCases) != c.Score.Total {
		return errors.New("incomplete hidden cases")
	}
	passed := 0
	for i, result := range c.HiddenCases {
		if result.Index != i {
			return errors.New("invalid hidden case index")
		}
		switch result.Status {
		case execution.Accepted:
			passed++
		case execution.WrongAnswer, execution.TimeLimit:
		default:
			return errors.New("invalid hidden case status")
		}
	}
	if passed != c.Score.Passed {
		return errors.New("inconsistent hidden score")
	}
	return nil
}
