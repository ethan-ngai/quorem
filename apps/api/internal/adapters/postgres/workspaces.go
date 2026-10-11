package postgres

import (
	"context"
	"errors"
	"github.com/ethan-ngai/quorem/apps/api/internal/workspace"
	"github.com/jackc/pgx/v5"
	"strconv"
)

func (s *Store) CreateWorkspace(ctx context.Context, owner, problemID, language string) (workspace.Workspace, error) {
	if language != "python" {
		return workspace.Workspace{}, failure("invalid_input", 400, "Only Python is supported")
	}
	p, err := s.Problem(ctx, problemID, true)
	if err != nil {
		return workspace.Workspace{}, err
	}
	var id string
	err = s.Pool.QueryRow(ctx, "INSERT INTO workspaces(id,owner_id,problem_version_id,language,source) VALUES($1,$2,$3,$4,$5) ON CONFLICT(owner_id,problem_version_id,language) WHERE kind='solo' DO UPDATE SET owner_id=EXCLUDED.owner_id RETURNING id", ID(), owner, p.ID, language, p.StarterSource).Scan(&id)
	if err != nil {
		return workspace.Workspace{}, err
	}
	return s.Workspace(ctx, owner, id)
}
func (s *Store) Workspace(ctx context.Context, owner, id string) (workspace.Workspace, error) {
	var w workspace.Workspace
	var revision int64
	err := s.Pool.QueryRow(ctx, "SELECT id,kind,problem_version_id,language,source,revision,updated_at,COALESCE(match_id::text,'') FROM workspaces WHERE id::text=$1 AND owner_id=$2", id, owner).Scan(&w.ID, &w.Kind, &w.ProblemVersionID, &w.Language, &w.Draft.Source, &revision, &w.Draft.SavedAt, &w.MatchID)
	if errors.Is(err, pgx.ErrNoRows) {
		return w, failure("not_found", 404, "Workspace not found")
	}
	w.Draft.Revision = strconv.FormatInt(revision, 10)
	w.Preferences = map[string]any{"theme": "system", "codeFontSize": 14, "tabSize": 4, "wrap": false, "paneRatios": []float64{0.42, 0.58}}
	return w, err
}
func (s *Store) Save(ctx context.Context, owner, id, source, session, sequence string, restore *int64) (workspace.Draft, error) {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return workspace.Draft{}, err
	}
	defer tx.Rollback(ctx)
	var rev int64
	if err = tx.QueryRow(ctx, "SELECT revision FROM workspaces WHERE id::text=$1 AND owner_id=$2 FOR UPDATE", id, owner).Scan(&rev); errors.Is(err, pgx.ErrNoRows) {
		return workspace.Draft{}, failure("not_found", 404, "Workspace not found")
	}
	if err != nil {
		return workspace.Draft{}, err
	}
	if restore != nil {
		if err = tx.QueryRow(ctx, "SELECT source FROM draft_versions WHERE workspace_id::text=$1 AND revision=$2", id, *restore).Scan(&source); errors.Is(err, pgx.ErrNoRows) {
			return workspace.Draft{}, failure("not_found", 404, "Revision not found")
		}
		if err != nil {
			return workspace.Draft{}, err
		}
	} else {
		tag, e := tx.Exec(ctx, "INSERT INTO draft_sessions(workspace_id,session_id,sequence) VALUES($1,$2,$3::numeric) ON CONFLICT(workspace_id,session_id) DO UPDATE SET sequence=EXCLUDED.sequence WHERE draft_sessions.sequence < EXCLUDED.sequence", id, session, sequence)
		if e != nil {
			return workspace.Draft{}, e
		}
		if tag.RowsAffected() == 0 {
			return workspace.Draft{}, failure("stale_session_save", 409, "Save sequence is older than the current session")
		}
	}
	var d workspace.Draft
	var next int64
	err = tx.QueryRow(ctx, "UPDATE workspaces SET source=$2,revision=revision+1,updated_at=clock_timestamp() WHERE id::text=$1 RETURNING source,revision,updated_at", id, source).Scan(&d.Source, &next, &d.SavedAt)
	if err != nil {
		return d, err
	}
	d.Revision = strconv.FormatInt(next, 10)
	if _, err = tx.Exec(ctx, "INSERT INTO draft_versions(workspace_id,revision,source,saved_at) VALUES($1,$2,$3,$4)", id, next, source, d.SavedAt); err != nil {
		return d, err
	}
	if _, err = tx.Exec(ctx, "DELETE FROM draft_versions WHERE workspace_id::text=$1 AND (saved_at < clock_timestamp()-interval '30 days' OR revision <= $2-100)", id, next); err != nil {
		return d, err
	}
	err = tx.Commit(ctx)
	return d, err
}
func (s *Store) History(ctx context.Context, owner, id string, cursor int64, limit int) (workspace.History, error) {
	if _, err := s.Workspace(ctx, owner, id); err != nil {
		return workspace.History{}, err
	}
	rows, err := s.Pool.Query(ctx, "SELECT source,revision,saved_at FROM draft_versions WHERE workspace_id::text=$1 AND revision<$2 AND saved_at>=clock_timestamp()-interval '30 days' ORDER BY revision DESC LIMIT $3", id, cursor, limit+1)
	if err != nil {
		return workspace.History{}, err
	}
	defer rows.Close()
	h := workspace.History{Items: []workspace.Draft{}}
	for rows.Next() {
		var d workspace.Draft
		var rev int64
		if err = rows.Scan(&d.Source, &rev, &d.SavedAt); err != nil {
			return h, err
		}
		d.Revision = strconv.FormatInt(rev, 10)
		h.Items = append(h.Items, d)
	}
	if len(h.Items) > limit {
		h.Items = h.Items[:limit]
		h.NextCursor = h.Items[limit-1].Revision
	}
	return h, rows.Err()
}
