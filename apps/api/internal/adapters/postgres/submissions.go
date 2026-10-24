package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/ethan-ngai/quorem/apps/api/internal/application"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/jackc/pgx/v5"
	"time"
)

func Hash(data []byte) string { return application.Hash(data) }
func (s *Store) Admit(ctx context.Context, owner, key string, c judging.Command, bodyHash string) (judging.Submission, error) {
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
		v, e := s.submission(ctx, tx, owner, prior)
		v.State = "queued"
		return v, e
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return judging.Submission{}, err
	}
	var fixtureData []byte
	var language, runtimeRevision, harnessRevision string
	var matchID string
	var odysseyScope string
	var odysseyLevel *int
	var matchSequence *int64
	var admissionTime any
	err = tx.QueryRow(ctx, "SELECT p.fixture,COALESCE(w.match_id::text,''),w.language,l.runtime_revision,l.harness_revision,COALESCE(w.odyssey_scope,w.id)::text FROM workspaces w JOIN problem_versions p ON p.id=w.problem_version_id JOIN problem_languages l ON l.version_id=w.problem_version_id AND l.language=w.language WHERE w.id::text=$1 AND w.owner_id=$2", c.WorkspaceID, owner).Scan(&fixtureData, &matchID, &language, &runtimeRevision, &harnessRevision, &odysseyScope)
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
	cases := f.HiddenCases
	if f.Problem.Odyssey != nil {
		caps, e := s.Capabilities(ctx, owner)
		if e != nil {
			return judging.Submission{}, e
		}
		if !caps.Odyssey {
			return judging.Submission{}, failure("entitlement_required", 403, "Odyssey access required")
		}
		if matchID != "" {
			return judging.Submission{}, failure("invalid_input", 400, "Odyssey is unavailable in competitive matches")
		}
		if _, err = tx.Exec(ctx, "INSERT INTO odyssey_progress(scope_id,problem_version_id) VALUES($1,$2) ON CONFLICT DO NOTHING", odysseyScope, f.Problem.ID); err != nil {
			return judging.Submission{}, err
		}
		var level int
		if err = tx.QueryRow(ctx, "SELECT level FROM odyssey_progress WHERE scope_id=$1 AND problem_version_id=$2 FOR UPDATE", odysseyScope, f.Problem.ID).Scan(&level); err != nil {
			return judging.Submission{}, err
		}
		if c.Level != level {
			return judging.Submission{}, failure("revision_conflict", 409, "Odyssey level changed; reload progress")
		}
		var p problems.Problem
		p, cases, err = problems.CompileOdyssey(f, level, c.Kind)
		if err != nil {
			return judging.Submission{}, err
		}
		f.Problem = p
		odysseyLevel = &level
	}

	if c.Kind == "run" {
		if f.Problem.Odyssey == nil {
			cases = f.Problem.SampleCases()
		}
		if c.CustomCases != nil {
			if err = problems.ValidateProblemCustomCases(f.Problem, c.CustomCases); err != nil {
				return judging.Submission{}, failure("invalid_input", 400, err.Error())
			}
			cases = c.CustomCases
		}
	} else if c.CustomCases != nil {
		return judging.Submission{}, failure("invalid_input", 400, "Submit cannot choose cases")
	}
	for _, test := range cases {
		if err = problems.ValidateProblemCase(f.Problem, test, false); err != nil {
			return judging.Submission{}, failure("invalid_input", 400, err.Error())
		}
	}
	var busy bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM submissions WHERE owner_id=$1 AND state IN ('queued','running'))", owner).Scan(&busy); err != nil {
		return judging.Submission{}, err
	}
	if busy {
		return judging.Submission{}, failure("user_busy", 409, "Another execution is active")
	}
	var tokens float64
	var daily int
	err = tx.QueryRow(ctx, "SELECT LEAST(2,admission_tokens+EXTRACT(EPOCH FROM(clock_timestamp()-tokens_updated_at))/6.0),(SELECT count(*) FROM submissions WHERE owner_id=$1 AND admitted_at>clock_timestamp()-interval '24 hours') FROM users WHERE id=$1", owner).Scan(&tokens, &daily)
	if err != nil {
		return judging.Submission{}, err
	}
	if tokens < 1 || daily >= 100 {
		return judging.Submission{}, failure("quota_exceeded", 429, "Execution quota reached")
	}
	sponsor, err := guestAdmission(ctx, tx, owner, matchID)
	if err != nil {
		return judging.Submission{}, err
	}
	// Serialize the global queue count with admission across API instances.
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(740020)"); err != nil {
		return judging.Submission{}, err
	}
	var pending int
	if err = tx.QueryRow(ctx, "SELECT count(*) FROM execution_jobs WHERE NOT finished").Scan(&pending); err != nil {
		return judging.Submission{}, err
	}
	if pending >= 200 {
		return judging.Submission{}, failure("queue_saturated", 429, "Judge queue is full")
	}
	id := ID()
	encoded, _ := json.Marshal(cases)
	if _, err = tx.Exec(ctx, "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases,match_id,match_sequence,admitted_at,odyssey_level) VALUES($1,$2,$3,$4,$5,$6,'queued',$7,NULLIF($8,'')::uuid,$9,COALESCE($10::timestamptz,clock_timestamp()),$11)", id, owner, c.WorkspaceID, c.Kind, c.Source, Hash([]byte(c.Source)), encoded, matchID, matchSequence, admissionTime, odysseyLevel); err != nil {
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

func (s *Store) submission(ctx context.Context, q querier, owner, id string) (judging.Submission, error) {
	var v judging.Submission
	var data []byte
	err := q.QueryRow(ctx, "SELECT id,workspace_id,kind,state,source_hash,admitted_at,updated_at,result FROM submissions WHERE id::text=$1 AND owner_id=$2", id, owner).Scan(&v.ID, &v.WorkspaceID, &v.Kind, &v.State, &v.SourceHash, &v.AdmittedAt, &v.UpdatedAt, &data)
	if errors.Is(err, pgx.ErrNoRows) {
		return v, failure("not_found", 404, "Submission not found")
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
			if prior != id {
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
	err = tx.QueryRow(ctx, "SELECT state,COALESCE(match_id::text,''),kind FROM submissions WHERE id::text=$1 AND owner_id=$2 FOR UPDATE", id, owner).Scan(&state, &matchID, &kind)
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
		if _, err = tx.Exec(ctx, "UPDATE execution_jobs SET finished=true,attempt_id=NULL WHERE submission_id::text=$1", id); err != nil {
			return judging.Submission{}, err
		}
		_, err = tx.Exec(ctx, "UPDATE submissions SET state='cancelled',cancel_requested=true,updated_at=clock_timestamp() WHERE id::text=$1", id)
	} else if state == "running" {
		_, err = tx.Exec(ctx, "UPDATE submissions SET cancel_requested=true,updated_at=clock_timestamp() WHERE id::text=$1", id)
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
	_, err := s.Pool.Exec(ctx, "DELETE FROM guest_request_buckets WHERE window_start<clock_timestamp()-interval '2 hours'; UPDATE submissions s SET source='',result=NULL,cases='[]'::jsonb WHERE admitted_at<clock_timestamp()-interval '7 days' AND state NOT IN ('queued','running') AND EXISTS(SELECT 1 FROM users u WHERE u.id=s.owner_id AND u.kind='guest'); UPDATE users u SET display_name='Expired guest' WHERE kind='guest' AND EXISTS(SELECT 1 FROM guest_sessions g WHERE g.owner_id=u.id AND g.expires_at<clock_timestamp()-interval '7 days'); DELETE FROM execution_idempotency WHERE expires_at < clock_timestamp(); DELETE FROM cancellation_idempotency WHERE expires_at < clock_timestamp(); UPDATE submissions SET source='',result=NULL WHERE admitted_at < clock_timestamp()-interval '30 days' AND state NOT IN ('queued','running')")
	return err
}
