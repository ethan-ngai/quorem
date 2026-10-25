package postgres

import (
	"context"
	"strings"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/access"
	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/apps/api/internal/matches"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/ethan-ngai/quorem/internal/execution"
)

func grantCustomAuthor(t *testing.T, s *Store, user string) {
	t.Helper()
	if err := s.ApplyGrant(context.Background(), access.Grant{OperationID: ID(), UserID: user, Actor: "test", Reason: "Private author test", Scope: "questions.custom", Source: "manual", Reference: "private-author"}, false); err != nil {
		t.Fatal(err)
	}
}
func authorContext(user string) context.Context {
	return identity.With(context.Background(), identity.Principal{UserID: user})
}
func TestPrivateQuestionAuthoringAndReadIsolation(t *testing.T) {
	s := testStore(t)
	alice, bob := authorContext("alice"), authorContext("bob")
	if _, err := s.Pool.Exec(alice, `UPDATE users SET role='user',disabled=false WHERE id IN ('alice','bob')`); err != nil {
		t.Fatal(err)
	}
	c := authoringContent(t, s)
	c.Problem.Tags = []string{"unique-private-secret-topic"}
	if _, err := s.CreateQuestionDraft(alice, "alice", c); errorCode(err) != "forbidden" {
		t.Fatal("ungated author", err)
	}
	grantCustomAuthor(t, s, "alice")
	grantCustomAuthor(t, s, "bob")
	d, err := s.CreateQuestionDraft(alice, "alice", c)
	if err != nil {
		t.Fatal(err)
	}
	for _, ctx := range []context.Context{bob, context.Background()} {
		if _, err = s.QuestionDraft(ctx, d.ID); errorCode(err) != "not_found" {
			t.Fatal("draft leak", err)
		}
		page, e := s.QuestionDrafts(ctx, "")
		if e != nil || len(page.Items) != 0 {
			t.Fatal("draft list leak", page, e)
		}
	}
	if _, err = s.UpdateQuestionDraft(bob, "bob", d.ID, d.Revision, c); errorCode(err) != "not_found" {
		t.Fatal("cross-owner update", err)
	}
	if _, err = s.PublishQuestionDraft(bob, "bob", d.ID, d.Revision); errorCode(err) != "not_found" {
		t.Fatal("cross-owner publish", err)
	}
	d, err = s.PublishQuestionDraft(alice, "alice", d.ID, d.Revision)
	if err != nil {
		t.Fatal(err)
	}
	own, err := s.Problem(alice, d.PublishedVersionID, true)
	if err != nil || !strings.HasPrefix(own.Slug, "private-") {
		t.Fatal(own, err)
	}
	if _, err = s.Problem(alice, own.Slug, false); err != nil {
		t.Fatal("private slug link", err)
	}
	for _, ctx := range []context.Context{bob, context.Background()} {
		if _, err = s.Problem(ctx, d.PublishedVersionID, true); errorCode(err) != "not_found" {
			t.Fatal("version leak", err)
		}
		if _, err = s.Problem(ctx, own.Slug, false); errorCode(err) != "not_found" {
			t.Fatal("slug leak", err)
		}
		if _, err = s.Solutions(ctx, d.PublishedVersionID); errorCode(err) != "not_found" {
			t.Fatal("editorial leak", err)
		}
		if _, err = s.QuestionContent(ctx, d.PublishedVersionID); errorCode(err) != "forbidden" {
			t.Fatal("hidden content leak", err)
		}
	}
	if _, err = s.CreateWorkspace(context.Background(), "bob", own.ID, "python"); errorCode(err) != "not_found" {
		t.Fatal("workspace leak", err)
	}
	if _, err = s.CreateWorkspace(context.Background(), "alice", own.ID, "python"); err != nil {
		t.Fatal("owner workspace", err)
	}
	for _, tc := range []struct {
		ctx     context.Context
		library string
		want    int
	}{{alice, "private", 1}, {bob, "private", 0}, {context.Background(), "private", 0}} {
		page, e := s.ProblemCatalog(tc.ctx, problems.ProblemFilter{Page: 1, Limit: 100, Library: tc.library})
		if tc.want == 0 {
			for _, tag := range page.Topics {
				if tag == "unique-private-secret-topic" {
					t.Fatal("private topic leak")
				}
			}
		}

		if e != nil || page.Total != tc.want {
			t.Fatal("private catalog", page, e)
		}
	}
	global, e := s.ProblemCatalog(alice, problems.ProblemFilter{Page: 1, Limit: 100, Library: "global"})
	if e != nil {
		t.Fatal(e)
	}
	for _, p := range global.Items {
		if p.ID == own.ID {
			t.Fatal("private question in global catalog")
		}
	}
	public, _ := s.Problem(alice, "run-widths", false)
	if _, err = s.QuestionContent(alice, public.ID); errorCode(err) != "forbidden" {
		t.Fatal("public hidden clone leak", err)
	}
	if _, err = s.interviewQuestion(bob, "bob", interviews.QuestionInput{ProblemVersionID: own.ID, Language: "python"}); errorCode(err) != "not_found" {
		t.Fatal("interview catalog leak", err)
	}
}
func TestInterviewCustomQuestionsPersistPrivateLanguageImplementations(t *testing.T) {
	s := interviewTestStore(t)
	ctx := authorContext("alice")
	q := customInterviewQuestion()
	q.Language = "java"
	q.Custom.StarterSource = "class Solution { public long increment(long n) { return n + 1; } }"
	v, err := s.CreateInterview(ctx, "alice", ID(), interviews.Create{Title: "Private Java interview", Question: q})
	if err != nil {
		t.Fatal(err)
	}
	page, err := s.ProblemCatalog(ctx, problems.ProblemFilter{Page: 1, Limit: 100, Library: "private"})
	if err != nil || page.Total != 1 {
		t.Fatal(page, err)
	}
	p := page.Items[0]
	if p.StarterSource == q.Custom.StarterSource || !strings.Contains(p.StarterSource, "class Solution:") {
		t.Fatal("Python projection used selected Java source", p.StarterSource)
	}
	for _, language := range []string{"python", "java", "typescript", "ocaml"} {
		var impl problems.LanguageImplementation
		for _, candidate := range p.Languages {
			if candidate.Language == language {
				impl = candidate
			}
		}
		runtime, _ := execution.LanguageRuntime(language)
		if impl.RuntimeRevision != runtime.Revision || impl.HarnessRevision != runtime.Harness || impl.StarterSource == "" {
			t.Fatal("wrong private implementation", language, impl)
		}
		if language == "java" && impl.StarterSource != q.Custom.StarterSource {
			t.Fatal("selected source lost")
		}
		if _, err = s.CreateWorkspace(ctx, "alice", p.ID, language); err != nil {
			t.Fatal(language, err)
		}
	}
	if _, err = s.Problem(context.Background(), p.ID, true); errorCode(err) != "not_found" {
		t.Fatal("custom interview global leak", err)
	}
	if v.Document.Source != q.Custom.StarterSource {
		t.Fatal("interview source changed", v.Document.Source)
	}
	if _, err = s.CreateInterview(ctx, "alice", ID(), interviews.Create{Title: "Denied custom", Question: q}); errorCode(err) != "quota_exceeded" {
		t.Fatal("quota", err)
	}
	var count int
	if err = s.Pool.QueryRow(ctx, `SELECT count(*) FROM problems WHERE owner_id='alice'`).Scan(&count); err != nil || count != 1 {
		t.Fatal("rejected create saved library question", count, err)
	}
}

func TestInterviewCustomQuestionPermissionIndependentOfHosting(t *testing.T) {
	s := interviewTestStore(t)
	ctx := context.Background()
	if _, err := s.Pool.Exec(ctx, `DELETE FROM entitlement_grants WHERE user_id='alice' AND feature='questions.custom'; UPDATE users SET role='user' WHERE id='alice'`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateInterview(ctx, "alice", ID(), interviews.Create{Title: "Catalog only host", Question: customInterviewQuestion()}); errorCode(err) != "forbidden" {
		t.Fatal("hosting bypassed custom permission", err)
	}
	p, err := s.Problem(ctx, "run-widths", false)
	if err != nil {
		t.Fatal(err)
	}
	v, err := s.CreateInterview(ctx, "alice", ID(), interviews.Create{Title: "Allowed catalog", Question: interviews.QuestionInput{Language: "python", ProblemVersionID: p.ID}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.UpdateInterviewQuestion(ctx, "alice", v.ID, ID(), customInterviewQuestion()); errorCode(err) != "forbidden" {
		t.Fatal("changing question bypassed permission", err)
	}
}

func TestInterviewBaselineAndMatchesExcludePrivateQuestions(t *testing.T) {
	s := interviewTestStore(t)
	ctx := context.Background()
	f, err := s.interviewQuestion(ctx, "alice", customInterviewQuestion())
	if err != nil {
		t.Fatal(err)
	}
	f.Problem.ID = "00000000-0000-4000-8000-000000000001"
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err = saveInterviewCustomQuestion(ctx, tx, "alice", f); err != nil {
		tx.Rollback(ctx)
		t.Fatal(err)
	}
	if err = validateMatchProblem(ctx, tx, matches.Settings{SelectedProblemVersionID: f.Problem.ID}); errorCode(err) != "invalid_input" {
		tx.Rollback(ctx)
		t.Fatal("private match selection", err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	v := createInterviewTest(t, s)
	if _, err = s.JoinInterview(ctx, "bob", strings.TrimPrefix(v.InvitePath, "/interview-invite/"), "", ""); err != nil {
		t.Fatal(err)
	}
	sub, err := s.AdmitInterview(ctx, "bob", v.ID, ID(), "run")
	if err != nil {
		t.Fatal(err)
	}
	var global bool
	if err = s.Pool.QueryRow(ctx, `SELECT p.owner_id IS NULL FROM workspaces w JOIN problem_versions v ON v.id=w.problem_version_id JOIN problems p ON p.id=v.problem_id WHERE w.id=$1`, sub.WorkspaceID).Scan(&global); err != nil || !global {
		t.Fatal("interview baseline exposed private workspace", global, err)
	}
}

func TestAdminChoosesPrivateOrGlobalPublication(t *testing.T) {
	s := adminStore(t)
	ctx := identity.With(context.Background(), identity.Principal{UserID: "alice", Admin: true})
	c := authoringContent(t, s)
	c.Problem.Slug = "scope-choice"
	for _, visibility := range []string{"private", "global"} {
		draft, err := s.CreateQuestionDraft(ctx, "alice", c)
		if err != nil {
			t.Fatal(err)
		}
		published, err := s.PublishQuestionDraftTo(ctx, "alice", draft.ID, draft.Revision, visibility)
		if err != nil {
			t.Fatal(visibility, err)
		}
		_, err = s.Problem(context.Background(), published.PublishedVersionID, true)
		if visibility == "private" && errorCode(err) != "not_found" {
			t.Fatal("private publication leaked", err)
		}
		if visibility == "global" && err != nil {
			t.Fatal("global publication hidden", err)
		}
		if _, err = s.Problem(ctx, published.PublishedVersionID, true); err != nil {
			t.Fatal("owner read", err)
		}
	}
	grantCustomAuthor(t, s, "bob")
	bob := authorContext("bob")
	draft, err := s.CreateQuestionDraft(bob, "bob", c)
	if err != nil {
		t.Fatal(err)
	}
	// A forged principal cannot grant global publication; the persisted role decides.
	forged := identity.With(bob, identity.Principal{UserID: "bob", Admin: true})
	if _, err = s.PublishQuestionDraftTo(forged, "bob", draft.ID, draft.Revision, "global"); errorCode(err) != "forbidden" {
		t.Fatal("global bypass", err)
	}
	if _, err = s.PublishQuestionDraftTo(bob, "bob", draft.ID, draft.Revision, "private"); err != nil {
		t.Fatal("denied attempt consumed draft", err)
	}
}
