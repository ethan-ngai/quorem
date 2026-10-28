package postgres

import (
	"context"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
)

func TestInterviewQuestionSelectionRequiresCurrentAccessibleVersion(t *testing.T) {
	s := adminStore(t)
	ctx := identity.With(context.Background(), identity.Principal{UserID: "alice", Admin: true})
	content := authoringContent(t, s)
	content.Problem.Slug = "interview-selection"
	publish := func() string {
		t.Helper()
		draft, err := s.CreateQuestionDraft(ctx, "alice", content)
		if err != nil {
			t.Fatal(err)
		}
		draft, err = s.PublishQuestionDraftTo(ctx, "alice", draft.ID, draft.Revision, "private")
		if err != nil {
			t.Fatal(err)
		}
		return draft.PublishedVersionID
	}
	first := publish()
	second := publish()
	for _, tc := range []struct {
		actor, version, language string
		want                     string
	}{
		{"alice", first, "python", "not_found"},
		{"bob", second, "python", "not_found"},
		{"alice", second, "postgresql", "invalid_input"},
	} {
		if _, err := s.interviewQuestion(ctx, tc.actor, interviews.QuestionInput{ProblemVersionID: tc.version, Language: tc.language}); errorCode(err) != tc.want {
			t.Fatalf("%+v: %v", tc, err)
		}
	}
	fixture, err := s.interviewQuestion(ctx, "alice", interviews.QuestionInput{ProblemVersionID: second, Language: "java"})
	if err != nil || fixture.Problem.ID != second || len(fixture.HiddenCases) != len(content.HiddenCases) || fixture.Problem.RuntimeRevision == "" || fixture.HarnessRevision == "" {
		t.Fatalf("owner fixture: %+v %v", fixture, err)
	}
	for _, implementation := range fixture.Problem.Languages {
		if implementation.Language == "java" && (fixture.Problem.StarterSource != implementation.StarterSource || fixture.Problem.RuntimeRevision != implementation.RuntimeRevision || fixture.HarnessRevision != implementation.HarnessRevision) {
			t.Fatal("selected language does not match immutable implementation")
		}
	}
}
