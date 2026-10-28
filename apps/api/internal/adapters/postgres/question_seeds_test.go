package postgres

import (
	"context"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
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
