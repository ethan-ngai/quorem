package postgres

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestSeedQuestionReusesEquivalentPublishedContent(t *testing.T) {
	for _, visibility := range []string{"global", "private"} {
		t.Run(visibility, func(t *testing.T) {
			s := adminStore(t)
			ctx := identity.With(context.Background(), identity.Principal{UserID: "alice", Admin: true})
			content := authoringContent(t, s)
			content.Problem.Slug = "seed-replay-" + visibility
			draft, err := s.CreateQuestionDraft(ctx, "alice", content)
			if err != nil {
				t.Fatal(err)
			}
			prefix := "seed:question:alice:" + visibility + ":"
			if _, err = s.Pool.Exec(ctx, `INSERT INTO access_audit(operation_id,actor,user_id,action,scope,reason) VALUES($1,'alice','alice','questions.seed',$2,'seed')`, prefix+"prior-representation", draft.ID); err != nil {
				t.Fatal(err)
			}
			draft, err = s.PublishQuestionDraftTo(ctx, "alice", draft.ID, draft.Revision, visibility)
			if err != nil {
				t.Fatal(err)
			}
			first := draft.PublishedVersionID
			content.Problem.ID = ID()
			content.Problem.Version = "99"
			content.Implementations[0].StarterSource = "superseded starter"
			for i, j := 0, len(content.Implementations)-1; i < j; i, j = i+1, j-1 {
				content.Implementations[i], content.Implementations[j] = content.Implementations[j], content.Implementations[i]
			}
			replayed, err := s.SeedQuestion(ctx, "alice", visibility, content)
			if err != nil || replayed != first {
				t.Fatalf("equivalent seed republished: %s %s %v", first, replayed, err)
			}
			original := content
			content.Problem.StatementMarkdown += " New requirement."
			changed, err := s.SeedQuestion(ctx, "alice", visibility, content)
			if err != nil || changed == first {
				t.Fatalf("changed seed not published: %s %s %v", first, changed, err)
			}
			restored, err := s.SeedQuestion(ctx, "alice", visibility, original)
			if err != nil || restored == first || restored == changed {
				t.Fatalf("older content was not republished as current: %s %s %s %v", first, changed, restored, err)
			}
			retry, err := s.SeedQuestion(ctx, "alice", visibility, original)
			if err != nil || retry != restored {
				t.Fatalf("current seed retry: %s %s %v", restored, retry, err)
			}
			reapplied, err := s.SeedQuestion(ctx, "alice", visibility, content)
			if err != nil || reapplied == changed || reapplied == restored {
				t.Fatalf("previously seeded content was not made current: %s %s %s %v", changed, restored, reapplied, err)
			}
		})
	}
}

func TestConcurrentEquivalentQuestionSeedsShareVersion(t *testing.T) {
	s := adminStore(t)
	ctx := identity.With(context.Background(), identity.Principal{UserID: "alice", Admin: true})
	content := authoringContent(t, s)
	content.Problem.Slug = "concurrent-seed"
	other := content
	other.Problem.ID = ID()
	results := make(chan struct {
		id  string
		err error
	}, 2)
	for _, candidate := range []problems.QuestionContent{content, other} {
		go func(candidate problems.QuestionContent) {
			id, err := s.SeedQuestion(ctx, "alice", "global", candidate)
			results <- struct {
				id  string
				err error
			}{id, err}
		}(candidate)
	}
	first, second := <-results, <-results
	if first.err != nil || second.err != nil || first.id == "" || first.id != second.id {
		t.Fatalf("concurrent seed results: %+v %+v", first, second)
	}
}

func TestQuestionSeedsUseOneConnectionPerOperation(t *testing.T) {
	s := adminStore(t)
	base := identity.With(context.Background(), identity.Principal{UserID: "alice", Admin: true})
	content := authoringContent(t, s)
	for _, connections := range []int32{1, 2} {
		t.Run(fmt.Sprintf("pool-%d", connections), func(t *testing.T) {
			config := s.Pool.Config()
			config.MaxConns = connections
			pool, err := pgxpool.NewWithConfig(base, config)
			if err != nil {
				t.Fatal(err)
			}
			defer pool.Close()
			limited := &Store{Pool: pool}
			ctx, cancel := context.WithTimeout(base, 15*time.Second)
			defer cancel()
			const count = 4
			results := make(chan error, count)
			for i := 0; i < count; i++ {
				candidate := content
				candidate.Problem.Slug = fmt.Sprintf("pool-%d-seed-%d", connections, i)
				go func() {
					first, err := limited.SeedQuestion(ctx, "alice", "global", candidate)
					if err == nil {
						var replay string
						replay, err = limited.SeedQuestion(ctx, "alice", "global", candidate)
						if err == nil && (first == "" || replay != first) {
							err = fmt.Errorf("seed replay mismatch")
						}
					}
					results <- err
				}()
			}
			for i := 0; i < count; i++ {
				if err := <-results; err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}

func TestSeedQuestionPreservesNULAndReplays(t *testing.T) {
	t.Setenv("QUOREM_LOSSLESS_RESULT_WRITES", "true")
	t.Setenv("QUOREM_LOSSLESS_CASES", "true")
	s := adminStore(t)
	ctx := identity.With(context.Background(), identity.Principal{UserID: "alice", Admin: true})
	p, err := s.Problem(ctx, "mirror-letters", false)
	if err != nil {
		t.Fatal(err)
	}
	content, err := s.QuestionContent(ctx, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	content.Problem.Slug = "seed-lossless"
	content.Problem.Examples[0].Args[0] = json.RawMessage(`"a\u0000b"`)
	content.HiddenCases[0].Args[0] = json.RawMessage(`"x\u0000y"`)
	before, _ := json.Marshal(content)
	first, err := s.SeedQuestion(ctx, "alice", "private", content)
	if err != nil {
		t.Fatal(err)
	}
	after, _ := json.Marshal(content)
	if !bytes.Equal(before, after) {
		t.Fatal("seed mutated caller content")
	}
	var published []byte
	if err = s.Pool.QueryRow(ctx, `SELECT lossless_content FROM question_drafts WHERE published_version_id=$1`, first).Scan(&published); err != nil {
		t.Fatal(err)
	}
	var saved problems.QuestionContent
	if err = json.Unmarshal(published, &saved); err != nil || !bytes.Contains(saved.Problem.Examples[0].Args[0], []byte(`\u0000`)) || !bytes.Contains(saved.HiddenCases[0].Args[0], []byte(`\u0000`)) {
		t.Fatalf("published draft lost cases: %v", err)
	}
	replay, err := s.SeedQuestion(ctx, "alice", "private", content)
	if err != nil || replay != first {
		t.Fatalf("replay: %s %s %v", first, replay, err)
	}
	fork, err := s.QuestionContent(ctx, first)
	if err != nil || !bytes.Contains(fork.Problem.Examples[0].Args[0], []byte(`\u0000`)) || !bytes.Contains(fork.HiddenCases[0].Args[0], []byte(`\u0000`)) {
		t.Fatalf("seed cases lost: %+v %v", fork, err)
	}
}
