package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/jackc/pgx/v5"
)

// SeedQuestion resumes a recorded draft, including interruption after publication.
func (s *Store) SeedQuestion(ctx context.Context, actor, visibility string, content problems.QuestionContent) (string, error) {
	content = problems.NormalizeQuestionDraft(content)
	if err := problems.ValidateQuestionPublication(content); err != nil {
		return "", err
	}
	data, err := json.Marshal(content)
	if err != nil {
		return "", err
	}
	key := "seed:question:" + actor + ":" + visibility + ":" + Hash(data)
	conn, err := s.Pool.Acquire(ctx)
	if err != nil {
		return "", err
	}
	defer conn.Release()
	if _, err = conn.Exec(ctx, "SELECT pg_advisory_lock(hashtextextended($1,740179))", key); err != nil {
		return "", err
	}
	defer func() {
		if _, e := conn.Exec(context.Background(), "SELECT pg_advisory_unlock(hashtextextended($1,740179))", key); e != nil {
			conn.Conn().Close(context.Background())
		}
	}()
	var id string
	err = conn.QueryRow(ctx, "SELECT scope FROM access_audit WHERE operation_id=$1", key).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		draft, e := s.CreateQuestionDraft(ctx, actor, content)
		if e != nil {
			return "", e
		}
		id = draft.ID
		_, err = conn.Exec(ctx, "INSERT INTO access_audit(operation_id,actor,user_id,action,scope,reason) VALUES($1,$2,$2,'questions.seed',$3,'Deployment question import')", key, actor, id)
	}
	if err != nil {
		return "", err
	}
	draft, err := s.QuestionDraft(ctx, id)
	if err != nil {
		return "", err
	}
	if draft.PublishedVersionID == "" {
		draft, err = s.PublishQuestionDraftTo(ctx, actor, id, draft.Revision, visibility)
		if err != nil {
			return "", fmt.Errorf("publish seed: %w", err)
		}
	}
	return draft.PublishedVersionID, nil
}
