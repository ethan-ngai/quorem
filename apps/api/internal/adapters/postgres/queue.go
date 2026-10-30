package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/internal/execution"
	"github.com/jackc/pgx/v5"
)

const runnableExecutionPredicate = `NOT j.finished AND s.state IN ('queued','running') AND ($1 OR NOT EXISTS(SELECT 1 FROM execution_checkpoints c WHERE c.job_id=j.id)) AND ($2 OR (s.lossless_cases IS NULL AND p.lossless_fixture IS NULL AND q.lossless_fixture IS NULL))`

func (s *Store) Claim(ctx context.Context) (execution.Job, error) {
	return s.claim(ctx, false, "", "")
}
func (s *Store) ClaimResumable(ctx context.Context) (execution.Job, error) {
	return s.claim(ctx, true, "", "")
}

// ClaimAfterTeardown accepts only the exact expired attempt already torn down by this worker.
func (s *Store) ClaimAfterTeardown(ctx context.Context, resumable bool, attempt, scope string) (execution.Job, error) {
	return s.claim(ctx, resumable, attempt, scope)
}
func (s *Store) claim(ctx context.Context, resumable bool, reaped, scope string) (execution.Job, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return execution.Job{}, err
	}
	defer tx.Rollback(ctx)
	lossless := losslessCasesEnabled()
	if lossless {
		if _, err = tx.Exec(ctx, "SELECT set_config('quorem.lossless_case_claim','v1',true)"); err != nil {
			return execution.Job{}, err
		}
	}
	if resumable {
		if _, err = tx.Exec(ctx, "SELECT set_config('quorem.checkpoint_claim','v1',true)"); err != nil {
			return execution.Job{}, err
		}
	}
	if _, err = tx.Exec(ctx, "SELECT set_config('quorem.sandbox_scope',$1,true)", scope); err != nil {
		return execution.Job{}, err
	}
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(740020)"); err != nil {
		return execution.Job{}, err
	}
	var j execution.Job
	var data []byte
	var suiteID string
	var cancelled bool
	var attempts int
	var previousAttempt *string
	err = tx.QueryRow(ctx, `SELECT j.id,j.submission_id,COALESCE(q.fixture->'problem'->>'id',w.problem_version_id::text),COALESCE(q.fixture->'problem'->>'id',p.id::text),COALESCE(q.fixture->'problem'->'limits',p.limits),s.cancel_requested,j.attempts,j.language,j.runtime_revision,j.harness_revision,j.attempt_id::text
 FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id LEFT JOIN workspaces w ON w.id=s.workspace_id LEFT JOIN problem_versions p ON p.id=w.problem_version_id LEFT JOIN interview_execution ie ON ie.submission_id=s.id LEFT JOIN interview_question_snapshots q ON q.session_id=ie.session_id AND q.id=ie.fixture_id
 WHERE `+runnableExecutionPredicate+` AND j.available_at<=clock_timestamp() AND (j.lease_until IS NULL OR j.lease_until<clock_timestamp()) AND (j.attempt_id IS NULL OR (j.attempt_id=$3 AND j.sandbox_scope=$4 AND $4<>''))
 ORDER BY j.available_at,j.id FOR UPDATE OF j,s SKIP LOCKED LIMIT 1`, resumable, lossless, uuidLookup(reaped), scope).Scan(&j.JobID, &j.SubmissionID, &j.ProblemVersionID, &suiteID, &data, &cancelled, &attempts, &j.Language, &j.RuntimeRevision, &j.HarnessRevision, &previousAttempt)
	if errors.Is(err, pgx.ErrNoRows) {
		return j, nil
	}
	if err != nil {
		return j, err
	}
	if previousAttempt != nil {
		if _, err = tx.Exec(ctx, "SELECT set_config('quorem.reaped_attempt',$1,true)", *previousAttempt); err != nil {
			return j, err
		}
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
	if err = json.Unmarshal(data, &j.Limits); err != nil {
		return j, err
	}
	j.AttemptID = ID()
	j.SandboxScope = scope
	j.SourceRef = j.SubmissionID
	j.SuiteRef = suiteID
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
	var problem, cases, rawCases, rawFixture []byte
	var level *int
	err := s.Pool.QueryRow(ctx, `SELECT s.source,s.kind,CASE WHEN ie.submission_id IS NULL THEN jsonb_build_object('signature',v.signature,'odyssey',v.odyssey,'sql',v.sql_config,'examples',`+problemExamplesSQL+`) ELSE jsonb_build_object('signature',q.fixture->'problem'->'signature','odyssey',q.fixture->'problem'->'odyssey','sql',q.fixture->'problem'->'sql','examples',q.fixture->'problem'->'examples') END,s.cases,ie.submission_id IS NOT NULL,(ie.submission_id IS NOT NULL AND s.kind='submit' AND COALESCE(jsonb_typeof(q.fixture->'problem'->'odyssey'),'null')='null' AND CASE COALESCE(jsonb_typeof(q.fixture->'hiddenCases'),'null') WHEN 'array' THEN jsonb_array_length(q.fixture->'hiddenCases') WHEN 'null' THEN 0 ELSE -1 END=0),`+admittedOdysseyLevelSQL+`,s.lossless_cases,COALESCE(q.lossless_fixture,v.lossless_fixture) FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id LEFT JOIN workspaces w ON w.id=s.workspace_id LEFT JOIN problem_versions v ON v.id=w.problem_version_id LEFT JOIN interview_execution ie ON ie.submission_id=s.id LEFT JOIN interview_question_snapshots q ON q.session_id=ie.session_id AND q.id=ie.fixture_id WHERE j.id=$1 AND j.attempt_id=$2 AND j.lease_until>clock_timestamp() AND NOT j.finished AND s.id=$3`, uuidLookup(j.JobID), uuidLookup(j.AttemptID), uuidLookup(j.SubmissionID)).Scan(&spec.Source, &spec.Kind, &problem, &cases, &spec.PrivateDetails, &spec.SubmitCasesAreSamples, &level, &rawCases, &rawFixture)
	if err != nil {
		return spec, err
	}
	if err = json.Unmarshal(problem, &spec.Problem); err != nil {
		return spec, err
	}
	if err = restoreProblemCases(&spec.Problem, rawFixture); err != nil {
		return spec, err
	}
	err = json.Unmarshal(authoritativeJSON(cases, rawCases), &spec.Cases)
	if err == nil {
		err = limitAdmittedOdyssey(&spec.Problem, level)
	}
	if err == nil && spec.Kind == "submit" {
		spec.SubmitSamples = spec.Problem.SampleCases()
	}
	return spec, err
}

func (s *Store) Lease(ctx context.Context, j execution.Job, heartbeat bool) (bool, error) {
	var cancelled bool
	query := `SELECT s.cancel_requested FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE j.id=$1 AND j.attempt_id=$2 AND NOT j.finished AND j.lease_until>clock_timestamp() AND s.id=$3`
	err := s.Pool.QueryRow(ctx, query, uuidLookup(j.JobID), uuidLookup(j.AttemptID), uuidLookup(j.SubmissionID)).Scan(&cancelled)
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
		tag, e := s.Pool.Exec(ctx, "UPDATE execution_jobs SET lease_until=clock_timestamp()+interval '90 seconds' WHERE id=$1 AND attempt_id=$2 AND NOT finished AND lease_until>clock_timestamp() AND submission_id=$3", uuidLookup(j.JobID), uuidLookup(j.AttemptID), uuidLookup(j.SubmissionID))
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
	if s.losslessResults {
		if _, err = tx.Exec(ctx, "SELECT set_config('quorem.lossless_result_write','v1',true)"); err != nil {
			return err
		}
	}
	var matchID string
	err = tx.QueryRow(ctx, "SELECT COALESCE(s.match_id::text,'') FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE j.id=$1 AND s.id=$2", uuidLookup(j.JobID), uuidLookup(j.SubmissionID)).Scan(&matchID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
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
	err = tx.QueryRow(ctx, `SELECT s.cancel_requested,s.kind,j.attempts FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE j.id=$1 AND j.attempt_id=$2 AND NOT j.finished AND j.lease_until>clock_timestamp() AND s.state='running' AND s.id=$3 FOR UPDATE OF j,s`, uuidLookup(j.JobID), uuidLookup(j.AttemptID), uuidLookup(j.SubmissionID)).Scan(&cancelled, &kind, &attempts)
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
			if err = validateSubmitCompletion(c, admittedCount); err != nil {
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
		private, privatePayload, e := encodePublicResults(c.PrivateCaseResults, s.losslessResults)
		if e != nil {
			return e
		}
		if _, err = tx.Exec(ctx, `UPDATE interview_execution SET private_results=$2,private_results_payload=$3 WHERE submission_id=$1`, j.SubmissionID, private, privatePayload); err != nil {
			return err
		}
	}
	encoded, payload, err := encodeSubmissionResult(result, s.losslessResults)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "UPDATE submissions SET state=$2,result=$3,result_payload=$4,updated_at=clock_timestamp() WHERE id=$1", j.SubmissionID, state, encoded, payload); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "UPDATE execution_jobs SET finished=true,lease_until=NULL WHERE id=$1", j.JobID); err != nil {
		return err
	}
	if matchID != "" {
		if err = s.reconcileMatch(ctx, tx, &match); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// NextExpiredAttempt limits teardown work to one eligible lease per claim cycle.
func (s *Store) NextExpiredAttempt(ctx context.Context, resumable bool, scope string) (string, error) {
	if scope == "" {
		return "", nil
	}
	var attempt string
	err := s.Pool.QueryRow(ctx, `SELECT j.attempt_id::text FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id LEFT JOIN workspaces w ON w.id=s.workspace_id LEFT JOIN problem_versions p ON p.id=w.problem_version_id LEFT JOIN interview_execution ie ON ie.submission_id=s.id LEFT JOIN interview_question_snapshots q ON q.session_id=ie.session_id AND q.id=ie.fixture_id WHERE `+runnableExecutionPredicate+` AND j.available_at<=clock_timestamp() AND j.attempt_id IS NOT NULL AND j.lease_until<clock_timestamp() AND j.sandbox_scope=$3 ORDER BY j.available_at,j.id LIMIT 1`, resumable, losslessCasesEnabled(), scope).Scan(&attempt)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return attempt, err
}

func validateSubmitCompletion(c execution.Completion, admittedCount int) error {
	if c.Score == nil || admittedCount < 1 || c.Score.Total != admittedCount || c.Score.Passed < 0 || c.Score.Passed > admittedCount {
		return errors.New("incomplete hidden score")
	}
	switch c.Verdict {
	case execution.Accepted, execution.WrongAnswer, execution.SyntaxError, execution.RuntimeError, execution.TimeLimit, execution.MemoryLimit, execution.OutputLimit, execution.InvalidOutput:
	default:
		return errors.New("invalid submission verdict")
	}
	if (c.Verdict == execution.Accepted) != (c.Score.Passed == c.Score.Total) {
		return errors.New("verdict does not match hidden score")
	}
	return validateHiddenCases(c)
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
