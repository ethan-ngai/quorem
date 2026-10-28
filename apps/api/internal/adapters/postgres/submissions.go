package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/ethan-ngai/quorem/apps/api/internal/application"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/ethan-ngai/quorem/internal/execution"
	"github.com/jackc/pgx/v5"
	"time"
)

func Hash(data []byte) string { return application.Hash(data) }
func (s *Store) Admit(ctx context.Context, owner, key string, c judging.Command, bodyHash string) (judging.Submission, error) {
	if !execution.ValidSource(c.Source) {
		return judging.Submission{}, failure("invalid_input", 400, "Source must be valid UTF-8, at most 65536 bytes, and contain no NUL characters")
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return judging.Submission{}, err
	}
	defer tx.Rollback(ctx)
	var locked string
	if err = tx.QueryRow(ctx, "SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE", owner).Scan(&locked); err != nil {
		return judging.Submission{}, err
	}
	var prior, hash string
	err = tx.QueryRow(ctx, "SELECT submission_id,body_hash FROM execution_idempotency WHERE owner_id=$1 AND key=$2 AND expires_at>clock_timestamp()", owner, key).Scan(&prior, &hash)
	if err == nil {
		if hash != bodyHash {
			return judging.Submission{}, failure("idempotency_conflict", 409, "Key was used for a different command")
		}
		return s.submission(ctx, tx, owner, prior)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return judging.Submission{}, err
	}
	var fixtureData, rawFixture []byte
	var language, runtimeRevision, harnessRevision string
	var matchID string
	var odysseyScope string
	var odysseyLevel *int
	var matchSequence *int64
	var admissionTime any
	err = tx.QueryRow(ctx, `SELECT jsonb_build_object(
 'problem',jsonb_build_object('id',v.id,'signature',v.signature,'constraints',v.constraints,'limits',v.limits,'sql',v.sql_config,'odyssey',v.odyssey,'examples',`+problemExamplesSQL+`),
 'hiddenCases',CASE WHEN $3='submit' THEN `+problemHiddenCasesSQL+` ELSE '[]'::jsonb END,
 'odysseyHiddenCases',CASE WHEN $3='submit' THEN `+odysseySuitesSQL+` ELSE NULL END),
 COALESCE(w.match_id::text,''),w.language,l.runtime_revision,l.harness_revision,w.id::text,v.lossless_fixture
 FROM workspaces w JOIN problem_versions v ON v.id=w.problem_version_id JOIN problem_languages l ON l.version_id=w.problem_version_id AND l.language=w.language WHERE w.id=$1 AND w.owner_id=$2`, uuidLookup(c.WorkspaceID), owner, c.Kind).Scan(&fixtureData, &matchID, &language, &runtimeRevision, &harnessRevision, &odysseyScope, &rawFixture)
	if errors.Is(err, pgx.ErrNoRows) {
		return judging.Submission{}, failure("not_found", 404, "Workspace not found")
	}
	if err != nil {
		return judging.Submission{}, err
	}
	if matchID != "" {
		m, e := lockMatch(ctx, tx, matchID)
		if e != nil {
			return judging.Submission{}, e
		}
		// clock_timestamp is sampled only after acquiring the aggregate lock.
		var admitted time.Time
		if e = tx.QueryRow(ctx, "SELECT clock_timestamp()").Scan(&admitted); e != nil {
			return judging.Submission{}, e
		}
		if m.state != "active" || m.deadline == nil || !admitted.Before(*m.deadline) {
			return judging.Submission{}, failure("invalid_transition", 409, "Match admission is closed")
		}
		var forbidden bool
		if e = tx.QueryRow(ctx, "SELECT forfeited FROM match_participants WHERE match_id=$1 AND owner_id=$2", matchID, owner).Scan(&forbidden); e != nil {
			return judging.Submission{}, e
		}
		if forbidden {
			return judging.Submission{}, failure("invalid_transition", 409, "Match participant is forfeited")
		}
		admissionTime = admitted
		if c.Kind == "submit" {
			var sequence int64
			if e = tx.QueryRow(ctx, "UPDATE matches SET admission_sequence=admission_sequence+1 WHERE id=$1 RETURNING admission_sequence", matchID).Scan(&sequence); e != nil {
				return judging.Submission{}, e
			}
			matchSequence = &sequence
		}
	}
	var f problems.Fixture
	if err = json.Unmarshal(fixtureData, &f); err != nil {
		return judging.Submission{}, err
	}
	if len(rawFixture) > 0 {
		var original problems.Fixture
		if err = json.Unmarshal(rawFixture, &original); err != nil {
			return judging.Submission{}, err
		}
		if err = restoreProblemCases(&f.Problem, rawFixture); err != nil {
			return judging.Submission{}, err
		}
		if c.Kind == "submit" {
			f.HiddenCases, f.OdysseyHiddenCases = original.HiddenCases, original.OdysseyHiddenCases
		}
	}
	level := 0
	if f.Problem.Odyssey != nil {
		if _, err = tx.Exec(ctx, "INSERT INTO odyssey_progress(scope_id,problem_version_id) VALUES($1,$2) ON CONFLICT DO NOTHING", odysseyScope, f.Problem.ID); err != nil {
			return judging.Submission{}, err
		}
		if err = tx.QueryRow(ctx, "SELECT level FROM odyssey_progress WHERE scope_id=$1 AND problem_version_id=$2 FOR UPDATE", odysseyScope, f.Problem.ID).Scan(&level); err != nil {
			return judging.Submission{}, err
		}
		if c.Level != level {
			return judging.Submission{}, failure("revision_conflict", 409, "Odyssey level changed; reload progress")
		}
		odysseyLevel = &level
	}
	cases, err := executionCases(f, level, c.Kind, c.CustomCases, false)
	if err != nil {
		return judging.Submission{}, err
	}

	tokens, err := ownerExecutionAdmission(ctx, tx, owner)
	if err != nil {
		return judging.Submission{}, err
	}
	sponsor, err := guestAdmission(ctx, tx, owner, matchID)
	if err != nil {
		return judging.Submission{}, err
	}
	if err = executionQueueAdmission(ctx, tx); err != nil {
		return judging.Submission{}, err
	}
	id := ID()
	encoded, _ := json.Marshal(cases)
	encoded, lossless, err := caseStorageJSON(encoded, true)
	if err != nil {
		return judging.Submission{}, err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases,match_id,match_sequence,admitted_at,odyssey_level,custom_run,lossless_cases) VALUES($1,$2,$3,$4,$5,$6,'queued',$7,NULLIF($8,'')::uuid,$9,COALESCE($10::timestamptz,clock_timestamp()),$11,$12,$13)", id, owner, c.WorkspaceID, c.Kind, c.Source, Hash([]byte(c.Source)), encoded, matchID, matchSequence, admissionTime, odysseyLevel, c.CustomCases != nil, lossless); err != nil {
		return judging.Submission{}, err
	}
	jobID := ID()
	if _, err = tx.Exec(ctx, "INSERT INTO execution_jobs(id,submission_id,language,runtime_revision,harness_revision) VALUES($1,$2,$3,$4,$5)", jobID, id, language, runtimeRevision, harnessRevision); err != nil {
		return judging.Submission{}, err
	}
	if sponsor != "" {
		if _, err = tx.Exec(ctx, "INSERT INTO guest_execution_usage(submission_id,match_id,sponsor_id) VALUES($1,$2,$3)", id, matchID, sponsor); err != nil {
			return judging.Submission{}, err
		}
	}
	if _, err = tx.Exec(ctx, "INSERT INTO execution_idempotency(owner_id,key,body_hash,submission_id,expires_at) VALUES($1,$2,$3,$4,clock_timestamp()+interval '24 hours') ON CONFLICT(owner_id,key) DO UPDATE SET body_hash=EXCLUDED.body_hash,submission_id=EXCLUDED.submission_id,expires_at=EXCLUDED.expires_at", owner, key, bodyHash, id); err != nil {
		return judging.Submission{}, err
	}
	if _, err = tx.Exec(ctx, "UPDATE users SET admission_tokens=$2-1,tokens_updated_at=clock_timestamp() WHERE id=$1", owner, tokens); err != nil {
		return judging.Submission{}, err
	}
	if matchID != "" && c.Kind == "submit" {
		m, e := lockMatch(ctx, tx, matchID)
		if e != nil {
			return judging.Submission{}, e
		}
		if e = s.reconcileMatch(ctx, tx, &m); e != nil {
			return judging.Submission{}, e
		}
	}
	result, err := s.submission(ctx, tx, owner, id)
	if err != nil {
		return result, err
	}
	err = tx.Commit(ctx)
	if err == nil {
		result.ExecutionJobID = jobID
	}
	return result, err
}

type querier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func (s *Store) rawSubmission(ctx context.Context, q querier, owner, id string) (judging.Submission, bool, error) {
	var v judging.Submission
	var data []byte
	var interview bool
	err := q.QueryRow(ctx, "SELECT id,COALESCE(workspace_id::text,''),kind,state,source_hash,admitted_at,updated_at,COALESCE(result_payload,convert_to(result::text,'UTF8')),custom_run,interview_id IS NOT NULL FROM submissions WHERE id=$1 AND owner_id=$2", uuidLookup(id), owner).Scan(&v.ID, &v.WorkspaceID, &v.Kind, &v.State, &v.SourceHash, &v.AdmittedAt, &v.UpdatedAt, &data, &v.CustomRun, &interview)
	if errors.Is(err, pgx.ErrNoRows) {
		return v, false, failure("not_found", 404, "Submission not found")
	}
	if err == nil && len(data) > 0 {
		var result judging.Submission
		if err = json.Unmarshal(data, &result); err == nil {
			v.Verdict = result.Verdict
			v.Score = result.Score
			v.PublicCases = result.PublicCases
			v.HiddenCases = result.HiddenCases
			v.Diagnostics = result.Diagnostics
			v.InfrastructureError = result.InfrastructureError
		}
	}
	return v, interview, err
}

// Generic owner endpoints never expose interview-private case verdicts.
func (s *Store) submission(ctx context.Context, q querier, owner, id string) (judging.Submission, error) {
	v, interview, err := s.rawSubmission(ctx, q, owner, id)
	if interview && v.Kind == "submit" {
		v.HiddenCases = nil
		v.Diagnostics = nil
	}
	return v, err
}

func (s *Store) Submission(ctx context.Context, owner, id string) (judging.Submission, error) {
	return s.submission(ctx, s.Pool, owner, id)
}
func (s *Store) Cancel(ctx context.Context, owner, id string) (judging.Submission, error) {
	return s.CancelWithKey(ctx, owner, id, "")
}
func (s *Store) CancelWithKey(ctx context.Context, owner, id, key string) (judging.Submission, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return judging.Submission{}, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(740020)"); err != nil {
		return judging.Submission{}, err
	}
	if key != "" {
		var prior string
		var response []byte
		e := tx.QueryRow(ctx, "SELECT submission_id,response FROM cancellation_idempotency WHERE owner_id=$1 AND key=$2 AND expires_at>clock_timestamp()", owner, key).Scan(&prior, &response)
		if e == nil {
			if uuidLookup(prior) != uuidLookup(id) {
				return judging.Submission{}, failure("idempotency_conflict", 409, "Key was used for a different cancellation")
			}
			var v judging.Submission
			e = json.Unmarshal(response, &v)
			return v, e
		}
		if !errors.Is(e, pgx.ErrNoRows) {
			return judging.Submission{}, e
		}
	}
	var state, matchID, kind string
	err = tx.QueryRow(ctx, "SELECT state,COALESCE(match_id::text,''),kind FROM submissions WHERE id=$1 AND owner_id=$2 FOR UPDATE", uuidLookup(id), owner).Scan(&state, &matchID, &kind)
	if errors.Is(err, pgx.ErrNoRows) {
		return judging.Submission{}, failure("not_found", 404, "Submission not found")
	}
	if err != nil {
		return judging.Submission{}, err
	}
	if matchID != "" && kind == "submit" {
		return judging.Submission{}, failure("invalid_transition", 409, "Match submissions cannot be cancelled")
	}
	if state == "queued" {
		if _, err = tx.Exec(ctx, "UPDATE execution_jobs SET finished=true,attempt_id=NULL WHERE submission_id=$1", uuidLookup(id)); err != nil {
			return judging.Submission{}, err
		}
		_, err = tx.Exec(ctx, "UPDATE submissions SET state='cancelled',cancel_requested=true,updated_at=clock_timestamp() WHERE id=$1", uuidLookup(id))
	} else if state == "running" {
		_, err = tx.Exec(ctx, "UPDATE submissions SET cancel_requested=true,updated_at=clock_timestamp() WHERE id=$1", uuidLookup(id))
	} else if state != "cancelled" {
		return judging.Submission{}, failure("invalid_transition", 409, "Execution already finished")
	}
	if err != nil {
		return judging.Submission{}, err
	}
	v, err := s.submission(ctx, tx, owner, id)
	if err != nil {
		return v, err
	}
	if key != "" {
		encoded, _ := json.Marshal(v)
		if _, err = tx.Exec(ctx, "INSERT INTO cancellation_idempotency(owner_id,key,submission_id,response,expires_at) VALUES($1,$2,$3,$4,clock_timestamp()+interval '24 hours') ON CONFLICT(owner_id,key) DO UPDATE SET submission_id=EXCLUDED.submission_id,response=EXCLUDED.response,expires_at=EXCLUDED.expires_at", owner, key, id, encoded); err != nil {
			return v, err
		}
	}
	return v, tx.Commit(ctx)
}
func (s *Store) Cleanup(ctx context.Context) error {
	_, err := s.Pool.Exec(ctx, `DELETE FROM execution_checkpoints c USING execution_jobs j,submissions s,users u WHERE c.job_id=j.id AND j.submission_id=s.id AND u.id=s.owner_id AND s.state NOT IN ('queued','running') AND s.admitted_at<statement_timestamp()-CASE WHEN u.kind='guest' THEN interval '7 days' ELSE interval '30 days' END;
 UPDATE interview_execution e SET private_results=NULL,private_results_payload=NULL FROM submissions s JOIN users u ON u.id=s.owner_id WHERE e.submission_id=s.id AND s.state NOT IN ('queued','running') AND s.admitted_at<statement_timestamp()-CASE WHEN u.kind='guest' THEN interval '7 days' ELSE interval '30 days' END AND (e.private_results IS NOT NULL OR e.private_results_payload IS NOT NULL);
 DELETE FROM guest_request_buckets WHERE window_start<statement_timestamp()-interval '2 hours';
 UPDATE submissions s SET source='',result=NULL,cases='[]'::jsonb WHERE admitted_at<statement_timestamp()-interval '7 days' AND state NOT IN ('queued','running') AND (source<>'' OR result IS NOT NULL OR cases<>'[]'::jsonb) AND EXISTS(SELECT 1 FROM users u WHERE u.id=s.owner_id AND u.kind='guest');
 UPDATE users u SET display_name='Expired guest' WHERE kind='guest' AND display_name<>'Expired guest' AND EXISTS(SELECT 1 FROM guest_sessions g WHERE g.owner_id=u.id AND g.expires_at<statement_timestamp()-interval '7 days');
 DELETE FROM execution_idempotency WHERE expires_at < statement_timestamp();
 DELETE FROM cancellation_idempotency WHERE expires_at < statement_timestamp();
 DELETE FROM match_idempotency WHERE expires_at < statement_timestamp();
 UPDATE submissions SET source='',result=NULL,cases=CASE WHEN lossless_cases IS NULL THEN cases ELSE '[]'::jsonb END,lossless_cases=NULL WHERE admitted_at < statement_timestamp()-interval '30 days' AND state NOT IN ('queued','running') AND (source<>'' OR result IS NOT NULL OR lossless_cases IS NOT NULL)`)
	return err
}
