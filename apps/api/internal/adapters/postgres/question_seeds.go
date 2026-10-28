package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SeedQuestion resumes a recorded draft, including interruption after publication.
func (s *Store) SeedQuestion(ctx context.Context, actor, visibility string, content problems.QuestionContent) (string, error) {
	content = problems.NormalizeQuestionDraft(content)
	if err := problems.ValidateQuestionPublication(content); err != nil {
		return "", err
	}
	fingerprint, slug, err := seedQuestionFingerprint(content, actor)
	if err != nil {
		return "", err
	}
	prefix := "seed:question:" + actor + ":" + visibility + ":"
	key := prefix + fingerprint
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
	// All draft operations share the locked session; none need a second pool connection.
	id, err := findSeedQuestion(ctx, conn, actor, prefix, slug, fingerprint)
	if err != nil {
		return "", err
	}
	if id == "" {
		draft, err := createQuestionDraft(ctx, conn, actor, content)
		if err != nil {
			return "", err
		}
		id = draft.ID
		if _, err = conn.Exec(ctx, "INSERT INTO access_audit(operation_id,actor,user_id,action,scope,reason) VALUES($1,$2,$2,'questions.seed',$3,'Deployment question import')", key+":"+id, actor, id); err != nil {
			return "", err
		}
	}
	draft, err := questionDraft(ctx, conn, id)
	if err != nil {
		return "", err
	}
	if draft.PublishedVersionID == "" {
		draft, err = publishQuestionDraftTo(ctx, conn, actor, id, draft.Revision, visibility)
		if err != nil {
			return "", fmt.Errorf("publish seed: %w", err)
		}
	}
	return draft.PublishedVersionID, nil
}

// Seed identity ignores server-assigned metadata and starters regenerated at publication.
func seedQuestionFingerprint(content problems.QuestionContent, actor string) (string, string, error) {
	content = problems.NormalizeQuestionDraft(content)
	content.Problem.ID = ""
	content.Problem.Version = ""
	content.Problem.Slug = strings.TrimPrefix(content.Problem.Slug, "private-"+Hash([]byte(actor))[:16]+"-")
	slug := content.Problem.Slug
	content.Implementations = append([]problems.AuthoringImplementation(nil), content.Implementations...)
	for i := range content.Implementations {
		content.Implementations[i].StarterSource = ""
	}
	sort.Slice(content.Implementations, func(i, j int) bool { return content.Implementations[i].Language < content.Implementations[j].Language })
	content.Solutions = append([]problems.EditorialSolution(nil), content.Solutions...)
	sort.Slice(content.Solutions, func(i, j int) bool { return content.Solutions[i].Language < content.Solutions[j].Language })
	data, err := json.Marshal(content)
	if err != nil {
		return "", "", err
	}
	return Hash(data), slug, nil
}

func findSeedQuestion(ctx context.Context, conn *pgxpool.Conn, actor, prefix, slug, fingerprint string) (string, error) {
	privateSlug := "private-" + Hash([]byte(actor))[:16] + "-" + slug
	rows, err := conn.Query(ctx, `SELECT a.scope,d.content FROM access_audit a JOIN question_drafts d ON d.id::text=a.scope WHERE a.actor=$1 AND a.action='questions.seed' AND left(a.operation_id,length($2))=$2 AND d.content->'problem'->>'slug' IN ($3,$4) AND (d.published_version_id IS NULL OR EXISTS(SELECT 1 FROM problems p WHERE p.current_version_id=d.published_version_id)) ORDER BY (d.published_version_id IS NULL),a.occurred_at,a.operation_id`, actor, prefix, slug, privateSlug)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var data []byte
		if err := rows.Scan(&id, &data); err != nil {
			return "", err
		}
		var prior problems.QuestionContent
		if err := json.Unmarshal(data, &prior); err != nil {
			return "", err
		}
		match, _, err := seedQuestionFingerprint(prior, actor)
		if err != nil {
			return "", err
		}
		if match == fingerprint {
			return id, nil
		}
	}
	return "", rows.Err()
}
