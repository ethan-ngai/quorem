package postgres

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/jackc/pgx/v5"
)

func Hash(data []byte) string { h := sha256.Sum256(data); return hex.EncodeToString(h[:]) }
func (s *Store) Admit(ctx context.Context, owner, key string, c judging.Command, bodyHash string) (judging.Submission, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return judging.Submission{}, err
	}
	defer tx.Rollback(ctx)
	var locked string
	if err = tx.QueryRow(ctx, "SELECT id FROM users WHERE id=$1 FOR UPDATE", owner).Scan(&locked); err != nil {
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
	var fixtureData []byte
	err = tx.QueryRow(ctx, "SELECT p.fixture FROM workspaces w JOIN problem_versions p ON p.id=w.problem_version_id WHERE w.id::text=$1 AND w.owner_id=$2", c.WorkspaceID, owner).Scan(&fixtureData)
	if errors.Is(err, pgx.ErrNoRows) {
		return judging.Submission{}, failure("not_found", 404, "Workspace not found")
	}
	if err != nil {
		return judging.Submission{}, err
	}
	var f problems.Fixture
	if err = json.Unmarshal(fixtureData, &f); err != nil {
		return judging.Submission{}, err
	}
	cases := f.HiddenCases
	if c.Kind == "run" {
		cases = f.Problem.Examples
		if len(c.CustomCases) > 0 {
			cases = c.CustomCases
		}
		for _, test := range cases {
			if err = problems.ValidateCase(f.Problem.Signature, test, false); err != nil {
				return judging.Submission{}, failure("invalid_input", 400, err.Error())
			}
		}
	} else if len(c.CustomCases) > 0 {
		return judging.Submission{}, failure("invalid_input", 400, "Submit cannot choose cases")
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
	if _, err = tx.Exec(ctx, "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) VALUES($1,$2,$3,$4,$5,$6,'queued',$7)", id, owner, c.WorkspaceID, c.Kind, c.Source, Hash([]byte(c.Source)), encoded); err != nil {
		return judging.Submission{}, err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO execution_jobs(id,submission_id) VALUES($1,$2)", ID(), id); err != nil {
		return judging.Submission{}, err
	}
	if _, err = tx.Exec(ctx, "INSERT INTO execution_idempotency(owner_id,key,body_hash,submission_id,expires_at) VALUES($1,$2,$3,$4,clock_timestamp()+interval '24 hours') ON CONFLICT(owner_id,key) DO UPDATE SET body_hash=EXCLUDED.body_hash,submission_id=EXCLUDED.submission_id,expires_at=EXCLUDED.expires_at", owner, key, bodyHash, id); err != nil {
		return judging.Submission{}, err
	}
	if _, err = tx.Exec(ctx, "UPDATE users SET admission_tokens=$2-1,tokens_updated_at=clock_timestamp() WHERE id=$1", owner, tokens); err != nil {
		return judging.Submission{}, err
	}
	result, err := s.submission(ctx, tx, owner, id)
	if err != nil {
		return result, err
	}
	err = tx.Commit(ctx)
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
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return judging.Submission{}, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(740020)"); err != nil {
		return judging.Submission{}, err
	}
	var state string
	err = tx.QueryRow(ctx, "SELECT state FROM submissions WHERE id::text=$1 AND owner_id=$2 FOR UPDATE", id, owner).Scan(&state)
	if errors.Is(err, pgx.ErrNoRows) {
		return judging.Submission{}, failure("not_found", 404, "Submission not found")
	}
	if err != nil {
		return judging.Submission{}, err
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
	return v, tx.Commit(ctx)
}
func (s *Store) Cleanup(ctx context.Context) error {
	_, err := s.Pool.Exec(ctx, "DELETE FROM execution_idempotency WHERE expires_at < clock_timestamp(); UPDATE submissions SET source='',result=NULL WHERE admitted_at < clock_timestamp()-interval '30 days' AND state NOT IN ('queued','running'); DELETE FROM draft_versions WHERE saved_at < clock_timestamp()-interval '30 days'")
	return err
}
