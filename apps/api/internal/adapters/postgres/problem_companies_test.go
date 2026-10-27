package postgres

import (
	"context"
	"slices"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
)

func TestCompanyCatalogAndLeetcodeIdentity(t *testing.T) {
	s := adminStore(t)
	ctx := identity.With(context.Background(), identity.Principal{UserID: "alice", Admin: true})
	c := authoringContent(t, s)
	id := 12345678
	c.Problem.LeetcodeID = &id
	c.Problem.Companies = []string{"Acme", "Globex"}
	d, err := s.CreateQuestionDraft(ctx, "alice", c)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.PublishQuestionDraft(ctx, "alice", d.ID, d.Revision); err != nil {
		t.Fatal(err)
	}
	p, err := s.Problem(ctx, c.Problem.Slug, false)
	if err != nil || p.LeetcodeID == nil || *p.LeetcodeID != id || len(p.Companies) != 2 {
		t.Fatalf("metadata %+v %v", p, err)
	}
	page, err := s.ProblemCatalog(ctx, ProblemFilter{Company: "Acme,Globex", Page: 1, Limit: 20})
	if err != nil || page.Total != 1 || len(page.Companies) < 2 {
		t.Fatalf("catalog %+v %v", page, err)
	}
	if _, err = s.Pool.Exec(ctx, "UPDATE problems SET leetcode_id=$1 WHERE slug='segment-sums'", id); err == nil {
		t.Fatal("duplicate LeetCode ID accepted")
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE problems SET owner_id='alice' WHERE slug='segment-sums'; INSERT INTO companies(name) VALUES('Private Company') ON CONFLICT (lower(name)) DO NOTHING; INSERT INTO problem_companies(problem_id,company_id) SELECT p.id,c.id FROM problems p JOIN companies c ON c.name='Private Company' WHERE p.slug='segment-sums' ON CONFLICT DO NOTHING`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = s.Pool.Exec(ctx, "UPDATE problems SET owner_id=NULL WHERE slug='segment-sums'") })
	anonymous, err := s.ProblemCatalog(context.Background(), ProblemFilter{Page: 1, Limit: 20})
	if err != nil || slices.Contains(anonymous.Companies, "Private Company") {
		t.Fatalf("private company leaked: %+v %v", anonymous.Companies, err)
	}
	private, err := s.ProblemCatalog(ctx, ProblemFilter{Company: "Private Company", Library: "private", Page: 1, Limit: 20})
	if err != nil || private.Total != 1 || !slices.Contains(private.Companies, "Private Company") {
		t.Fatalf("private company unavailable: %+v %v", private, err)
	}
	c, err = s.QuestionContent(ctx, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	c.Problem.Companies = []string{}
	c.Problem.LeetcodeID = nil
	d, err = s.CreateQuestionDraft(ctx, "alice", c)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.PublishQuestionDraft(ctx, "alice", d.ID, d.Revision); err != nil {
		t.Fatal(err)
	}
	cleared, err := s.Problem(ctx, p.Slug, false)
	if err != nil || cleared.LeetcodeID != nil || len(cleared.Companies) != 0 {
		t.Fatalf("metadata not cleared: %+v %v", cleared, err)
	}
	if _, err = s.Pool.Exec(ctx, "UPDATE problems SET leetcode_id=NULL WHERE slug=$1", c.Problem.Slug); err != nil {
		t.Fatal(err)
	}
}
