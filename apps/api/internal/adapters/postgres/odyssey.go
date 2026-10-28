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
	var data, statuses, lossless []byte
	history := `SELECT s.id,s.admitted_at,s.result->'publicCases' AS cases FROM submissions s WHERE s.workspace_id=w.id AND s.state='completed' AND NOT s.custom_run AND s.odyssey_level IS NOT NULL AND s.admitted_at>=COALESCE(o.reset_at,'-infinity'::timestamptz)`
	err := s.Pool.QueryRow(ctx, `SELECT v.odyssey,v.lossless_stages,COALESCE(o.level,1),COALESCE(o.completed,false),(`+caseStatusesSQL(history)+`) FROM workspaces w JOIN problem_versions v ON v.id=w.problem_version_id LEFT JOIN odyssey_progress o ON o.scope_id=w.id AND o.problem_version_id=w.problem_version_id WHERE w.id=$1 AND w.owner_id=$2`, uuidLookup(id), owner).Scan(&data, &lossless, &result.Level, &result.Completed, &statuses)
	if errors.Is(err, pgx.ErrNoRows) {
		return result, failure("not_found", 404, "Workspace not found")
	}
	if err != nil {
		return result, err
	}
	var odyssey *problems.Odyssey
	if len(data) == 0 {
		return result, failure("invalid_input", 400, "Workspace is not Odyssey")
	}
	if err = json.Unmarshal(data, &odyssey); err != nil {
		return result, err
	}
	if odyssey == nil || result.Level < 1 || result.Level > len(odyssey.Levels) {
		return result, failure("invalid_input", 400, "Workspace is not Odyssey")
	}
	result.Levels = odyssey.Levels[:result.Level]
	if len(lossless) > 0 {
		var restored problems.Problem
		restored.Odyssey = &problems.Odyssey{Levels: result.Levels}
		if err = restoreProblemCases(&restored, lossless); err != nil {
			return result, err
		}
		result.Levels = restored.Odyssey.Levels
	}
	result.TotalLevels = len(odyssey.Levels)
	result.CaseStatuses, err = decodeCaseStatuses(statuses)
	return result, err
}

func (s *Store) advanceOdyssey(ctx context.Context, tx pgx.Tx, submissionID string) error {
	var scope *string
	var problemID string
	var level *int
	var total *int
	err := tx.QueryRow(ctx, `SELECT COALESCE(ie.progress_scope,w.id)::text,COALESCE(q.fixture->'problem'->>'id',w.problem_version_id::text),COALESCE(ie.level,s.odyssey_level),CASE WHEN q.fixture IS NOT NULL THEN COALESCE(NULLIF(jsonb_array_length(q.fixture->'odysseyHiddenCases'),0),jsonb_array_length(q.fixture->'problem'->'odyssey'->'levels')) ELSE jsonb_array_length(v.odyssey->'levels') END FROM submissions s LEFT JOIN workspaces w ON w.id=s.workspace_id LEFT JOIN problem_versions v ON v.id=w.problem_version_id LEFT JOIN interview_execution ie ON ie.submission_id=s.id LEFT JOIN interview_question_snapshots q ON q.session_id=ie.session_id AND q.id=ie.fixture_id WHERE s.id=$1`, submissionID).Scan(&scope, &problemID, &level, &total)
	if err != nil || scope == nil || level == nil || total == nil {
		return err
	}
	next := *level + 1
	completed := next > *total
	if completed {
		next = *total
	}
	_, err = tx.Exec(ctx, `UPDATE odyssey_progress SET level=$4,completed=$5 WHERE scope_id=$1 AND problem_version_id=$2 AND level=$3 AND NOT completed`, *scope, problemID, *level, next, completed)
	return err
}

// ResetOdyssey restarts practice progress without changing source or submission history.
func (s *Store) ResetOdyssey(ctx context.Context, owner, id string) error {
	if _, err := s.Odyssey(ctx, owner, id); err != nil {
		return err
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// Admission takes this same lock, preventing a new job between the busy check and reset.
	var locked string
	if err = tx.QueryRow(ctx, `SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE`, owner).Scan(&locked); err != nil {
		return err
	}
	var scope, problemID string
	err = tx.QueryRow(ctx, `SELECT id::text,problem_version_id::text FROM workspaces WHERE id=$1 AND owner_id=$2 AND kind='solo'`, uuidLookup(id), owner).Scan(&scope, &problemID)
	if errors.Is(err, pgx.ErrNoRows) {
		return failure("not_found", 404, "Practice workspace not found")
	}
	if err != nil {
		return err
	}
	var active bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM submissions WHERE workspace_id=$1 AND state IN ('queued','running'))`, uuidLookup(scope)).Scan(&active); err != nil {
		return err
	}
	if active {
		return failure("revision_conflict", 409, "Wait for judging to finish before resetting progress")
	}
	if _, err = tx.Exec(ctx, `INSERT INTO odyssey_progress(scope_id,problem_version_id,level,completed) VALUES($1,$2,1,false) ON CONFLICT(scope_id,problem_version_id) DO UPDATE SET level=1,completed=false,reset_at=clock_timestamp()`, scope, problemID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
