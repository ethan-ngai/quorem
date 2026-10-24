package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/jackc/pgx/v5"
)

func (s *Store) Odyssey(ctx context.Context, owner, id string) (problems.OdysseyProgress, error) {
	var result problems.OdysseyProgress
	caps, err := s.Capabilities(ctx, owner)
	if err != nil {
		return result, err
	}
	if !caps.Odyssey {
		return result, failure("entitlement_required", 403, "Odyssey access required")
	}
	var data []byte
	err = s.Pool.QueryRow(ctx, `SELECT p.fixture,COALESCE(o.level,1),COALESCE(o.completed,false) FROM workspaces w JOIN problem_versions p ON p.id=w.problem_version_id LEFT JOIN odyssey_progress o ON o.scope_id=COALESCE(w.odyssey_scope,w.id) AND o.problem_version_id=w.problem_version_id WHERE w.id::text=$1 AND w.owner_id=$2`, id, owner).Scan(&data, &result.Level, &result.Completed)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, failure("not_found", 404, "Workspace not found")
	}
	if err != nil {
		return result, err
	}
	var f problems.Fixture
	if err = json.Unmarshal(data, &f); err != nil {
		return result, err
	}
	p, _, err := problems.CompileOdyssey(f, result.Level, "run")
	if err != nil {
		return result, failure("invalid_input", 400, "Workspace is not Odyssey")
	}
	result.Levels = p.Odyssey.Levels
	result.TotalLevels = len(f.Problem.Odyssey.Levels)
	return result, nil
}

func (s *Store) advanceOdyssey(ctx context.Context, tx pgx.Tx, submissionID string) error {
	var scope, problemID string
	var level *int
	var fixture []byte
	err := tx.QueryRow(ctx, `SELECT COALESCE(ie.progress_scope,w.odyssey_scope,w.id)::text,COALESCE(ie.fixture->'problem'->>'id',w.problem_version_id::text),COALESCE(ie.level,s.odyssey_level),COALESCE(ie.fixture,p.fixture) FROM submissions s JOIN workspaces w ON w.id=s.workspace_id JOIN problem_versions p ON p.id=w.problem_version_id LEFT JOIN interview_execution ie ON ie.submission_id=s.id WHERE s.id=$1`, submissionID).Scan(&scope, &problemID, &level, &fixture)
	if err != nil || level == nil {
		return err
	}
	var f problems.Fixture
	if err = json.Unmarshal(fixture, &f); err != nil {
		return err
	}
	if f.Problem.Odyssey == nil {
		return nil
	}
	total := len(f.OdysseyHiddenCases)
	if total == 0 {
		total = len(f.Problem.Odyssey.Levels)
	}
	next := *level + 1
	completed := next > total
	if completed {
		next = total
	}
	_, err = tx.Exec(ctx, `UPDATE odyssey_progress SET level=$4,completed=$5 WHERE scope_id=$1 AND problem_version_id=$2 AND level=$3 AND NOT completed`, scope, problemID, *level, next, completed)
	return err
}
