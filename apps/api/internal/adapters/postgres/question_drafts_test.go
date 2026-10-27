package postgres

import (
	"context"
	"encoding/json"
	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"strings"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/ethan-ngai/quorem/internal/execution"
)

func adminStore(t *testing.T) *Store {
	t.Helper()
	s := testStore(t)
	ctx := identity.With(context.Background(), identity.Principal{UserID: "alice", Admin: true})
	if _, err := s.Pool.Exec(ctx, "UPDATE users SET role='admin' WHERE id='alice'"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Pool.Exec(ctx, "UPDATE users SET role='user' WHERE id='alice'") })
	return s
}
func authoringContent(t *testing.T, s *Store) problems.QuestionContent {
	t.Helper()
	ctx := identity.With(context.Background(), identity.Principal{UserID: "alice", Admin: true})
	p, err := s.Problem(ctx, "run-widths", false)
	if err != nil {
		t.Fatal(err)
	}
	c, err := s.QuestionContent(ctx, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	for i := range c.Implementations {
		if c.Implementations[i].Language == "python" {
			c.Implementations[i].HarnessRevision = execution.HarnessRevision
		}
	}
	return c
}
func TestQuestionDraftPublishingPreservesPriorVersions(t *testing.T) {
	s := adminStore(t)
	ctx := identity.With(context.Background(), identity.Principal{UserID: "alice", Admin: true})
	c := authoringContent(t, s)
	old := c.Problem
	workspace, err := s.CreateWorkspace(ctx, "alice", old.ID, "python")
	if err != nil {
		t.Fatal(err)
	}
	submission, err := s.Admit(ctx, "alice", "prior-version", judging.Command{WorkspaceID: workspace.ID, Kind: "submit", Source: "prior-source"}, "prior-source-hash")
	if err != nil {
		t.Fatal(err)
	}
	d, err := s.CreateQuestionDraft(ctx, "alice", c)
	if err != nil || d.Revision != "1" {
		t.Fatal(d, err)
	}
	if _, err = s.CreateQuestionDraft(ctx, "bob", c); errorCode(err) != "forbidden" {
		t.Fatal("non-admin authoring", err)
	}
	c.Problem.Title = "Run Widths revised"
	c.Problem.Signature.Description = "Explain the method"
	c.Problem.Signature.Parameters[0].Description = "Input values"
	for i := range c.Implementations {
		c.Implementations[i].StarterSource = "obsolete authored starter"
	}
	changed, err := s.UpdateQuestionDraft(ctx, "alice", d.ID, "1", c)
	if err != nil || changed.Revision != "2" {
		t.Fatal(changed, err)
	}
	if _, err = s.UpdateQuestionDraft(ctx, "alice", d.ID, "1", c); errorCode(err) != "revision_conflict" {
		t.Fatal("stale update", err)
	}
	if _, err = s.PublishQuestionDraft(ctx, "alice", d.ID, "1"); errorCode(err) != "revision_conflict" {
		t.Fatal("stale publication", err)
	}
	published, err := s.PublishQuestionDraft(ctx, "alice", d.ID, "2")
	if err != nil || published.PublishedVersionID == "" || published.Revision != "3" {
		t.Fatal(published, err)
	}
	latest, err := s.Problem(ctx, old.Slug, false)
	if err != nil || latest.ID != published.PublishedVersionID || latest.Title != c.Problem.Title {
		t.Fatal(latest, err)
	}
	if latest.Signature.Description != "Explain the method" || latest.Signature.Parameters[0].Description != "Input values" {
		t.Fatal("method documentation lost", latest.Signature)
	}
	for _, implementation := range latest.Languages {
		if !strings.Contains(implementation.StarterSource, "Explain the method") || strings.Contains(implementation.StarterSource, "obsolete authored starter") {
			t.Fatal("starter not generated from documentation", implementation.Language, implementation.StarterSource)
		}
	}
	prior, err := s.Problem(ctx, old.ID, true)
	if err != nil || prior.Title != old.Title {
		t.Fatal("old publication changed", prior, err)
	}
	w, err := s.Workspace(ctx, "alice", workspace.ID)
	if err != nil || w.ProblemVersionID != old.ID {
		t.Fatal("old workspace changed", w, err)
	}
	oldSubmission, err := s.Submission(ctx, "alice", submission.ID)
	if err != nil || oldSubmission.ID != submission.ID {
		t.Fatal("old submission changed", oldSubmission, err)
	}
	var submissionVersion string
	if err = s.Pool.QueryRow(ctx, "SELECT w.problem_version_id::text FROM submissions s JOIN workspaces w ON w.id=s.workspace_id WHERE s.id=$1", submission.ID).Scan(&submissionVersion); err != nil || submissionVersion != old.ID {
		t.Fatal("old submission version changed", submissionVersion, err)
	}
	if _, err = s.PublishQuestionDraft(ctx, "alice", d.ID, "3"); errorCode(err) != "revision_conflict" {
		t.Fatal("republished same draft", err)
	}
	if _, err = s.UpdateQuestionDraft(ctx, "alice", d.ID, "3", c); errorCode(err) != "revision_conflict" {
		t.Fatal("edited published draft", err)
	}
	if _, err = s.Pool.Exec(ctx, "DELETE FROM problem_test_cases WHERE version_id=$1", latest.ID); err == nil {
		t.Fatal("publication not sealed")
	}
	fork, err := s.QuestionContent(ctx, latest.ID)
	if err != nil {
		t.Fatal(err)
	}
	next, err := s.CreateQuestionDraft(ctx, "alice", fork)
	if err != nil {
		t.Fatal(err)
	}
	next, err = s.PublishQuestionDraft(ctx, "alice", next.ID, next.Revision)
	if err != nil || next.PublishedVersionID == latest.ID {
		t.Fatal("new-version publication", next, err)
	}
	page, err := s.QuestionDrafts(ctx, "")
	if err != nil || len(page.Items) != 2 {
		t.Fatal(page, err)
	}
}
func TestQuestionDraftPublicationValidationAndAtomicRollback(t *testing.T) {
	s := adminStore(t)
	ctx := identity.With(context.Background(), identity.Principal{UserID: "alice", Admin: true})
	c := authoringContent(t, s)
	empty, err := s.CreateQuestionDraft(ctx, "alice", problems.QuestionContent{})
	if err != nil {
		t.Fatal("incomplete draft rejected", err)
	}
	if _, err = s.PublishQuestionDraft(ctx, "alice", empty.ID, empty.Revision); errorCode(err) != "invalid_input" {
		t.Fatal("incomplete draft published", err)
	}
	d, err := s.CreateQuestionDraft(ctx, "alice", c)
	if err != nil {
		t.Fatal(err)
	}
	var before int
	if err = s.Pool.QueryRow(ctx, "SELECT count(*) FROM problem_versions").Scan(&before); err != nil {
		t.Fatal(err)
	}
	// Fail after the pointer/children/seal are written, proving the complete transaction rolls back.
	if _, err = s.Pool.Exec(ctx, `CREATE FUNCTION test_reject_publication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.published_version_id IS NOT NULL THEN RAISE EXCEPTION 'injected publication failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_reject_publication AFTER UPDATE ON question_drafts FOR EACH ROW EXECUTE FUNCTION test_reject_publication()`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		s.Pool.Exec(ctx, "DROP TRIGGER IF EXISTS test_reject_publication ON question_drafts; DROP FUNCTION IF EXISTS test_reject_publication()")
	})
	if _, err = s.PublishQuestionDraft(ctx, "alice", d.ID, d.Revision); err == nil {
		t.Fatal("injected failure ignored")
	}
	var after int
	if err = s.Pool.QueryRow(ctx, "SELECT count(*) FROM problem_versions").Scan(&after); err != nil || after != before {
		t.Fatal("partial version persisted", before, after, err)
	}
	current, err := s.Problem(ctx, c.Problem.Slug, false)
	if err != nil || current.ID != c.Problem.ID {
		t.Fatal("partial pointer persisted", current.ID, err)
	}
	unchanged, err := s.QuestionDraft(ctx, d.ID)
	if err != nil || unchanged.Revision != d.Revision || unchanged.PublishedVersionID != "" {
		t.Fatal("partial draft persisted", unchanged, err)
	}
}
func TestQuestionPublicationRejectsUnsafeMetadata(t *testing.T) {
	s := adminStore(t)
	valid := authoringContent(t, s)
	cases := map[string]func(*problems.QuestionContent){
		"unknown runtime":          func(c *problems.QuestionContent) { c.Implementations[0].RuntimeRevision = "unknown" },
		"duplicate implementation": func(c *problems.QuestionContent) { c.Implementations = append(c.Implementations, c.Implementations[0]) },
		"unsupported comparator":   func(c *problems.QuestionContent) { c.Comparator = "unchecked" },
		"hidden count":             func(c *problems.QuestionContent) { c.HiddenCases = c.HiddenCases[:19] },
		"bad codec":                func(c *problems.QuestionContent) { c.Problem.Signature.Parameters[0].Type = "unknown" },
		"wrong arity":              func(c *problems.QuestionContent) { c.HiddenCases[0].Args = nil },
		"bad expected":             func(c *problems.QuestionContent) { c.HiddenCases[0].Expected = json.RawMessage(`"wrong-type"`) },
		"excess limits":            func(c *problems.QuestionContent) { c.Problem.Limits.WallTimeMS = 999999 },
		"duplicate tag":            func(c *problems.QuestionContent) { c.Problem.Tags = append(c.Problem.Tags, c.Problem.Tags[0]) },
		"editorial without variables": func(c *problems.QuestionContent) {
			c.Solutions = []problems.EditorialSolution{{Language: "python", Source: "source", ExplanationMarkdown: "explain", TimeComplexity: "O(n)", SpaceComplexity: "O(n)"}}
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			data, _ := json.Marshal(valid)
			var c problems.QuestionContent
			json.Unmarshal(data, &c)
			mutate(&c)
			if err := problems.ValidateQuestionPublication(c); err == nil {
				t.Fatal("invalid metadata accepted")
			}
		})
	}
}
