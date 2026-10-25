package httpapi

import (
	"context"
	"github.com/ethan-ngai/quorem/apps/api/internal/access"
	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/apps/api/internal/matches"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
	"github.com/ethan-ngai/quorem/apps/api/internal/workspace"
)

// Repositories expose atomic application operations, never connections or transactions.
type ProblemRepository interface {
	ProblemCatalog(context.Context, problems.ProblemFilter) (problems.ProblemPage, error)
	Problem(context.Context, string, bool) (problems.Problem, error)
	Solutions(context.Context, string) ([]problems.EditorialSolution, error)
	HasActiveMatchProblem(context.Context, string, string) (bool, error)
}
type QuestionRepository interface {
	QuestionDrafts(context.Context, string) (problems.QuestionDraftPage, error)
	QuestionDraft(context.Context, string) (problems.QuestionDraft, error)
	QuestionContent(context.Context, string) (problems.QuestionContent, error)
	CreateQuestionDraft(context.Context, string, problems.QuestionContent) (problems.QuestionDraft, error)
	UpdateQuestionDraft(context.Context, string, string, string, problems.QuestionContent) (problems.QuestionDraft, error)
	PublishQuestionDraftTo(context.Context, string, string, string, string) (problems.QuestionDraft, error)
}
type ExecutionRepository interface {
	CreateWorkspace(context.Context, string, string, string) (workspace.Workspace, error)
	Workspace(context.Context, string, string) (workspace.Workspace, error)
	Admit(context.Context, string, string, judging.Command, string) (judging.Submission, error)
	Submission(context.Context, string, string) (judging.Submission, error)
	CancelWithKey(context.Context, string, string, string) (judging.Submission, error)
}
type MatchRepository interface {
	EndGuestSession(context.Context, string) (bool, error)
	RotateInvite(context.Context, string, string, string) (matches.Created, error)
	RemoveGuest(context.Context, string, string, string, string) (matches.Snapshot, error)
	Capabilities(context.Context, string) (access.Capabilities, error)
	GuestIdentity(context.Context, string) (identity.Principal, error)
	JoinGuest(context.Context, string, string, string) (matches.Snapshot, error)
	PreviewInvite(context.Context, string) (matches.InvitePreview, error)
	ActiveMatch(context.Context, string) (*matches.Snapshot, error)
	CreateMatch(context.Context, string, string, matches.Settings) (matches.Created, error)
	JoinMatch(context.Context, string, string, string) (matches.Snapshot, error)
	Match(context.Context, string, string) (matches.Snapshot, error)
	StartMatch(context.Context, string, string, string) (matches.Snapshot, error)
	ReadyMatch(context.Context, string, string, string, bool) (matches.Snapshot, error)
	UpdateMatchSettings(context.Context, string, string, string, matches.Settings) (matches.Snapshot, error)
	ReportMatchRule(context.Context, string, string, string, string) (matches.Snapshot, error)
	ForfeitMatch(context.Context, string, string, string) (matches.Snapshot, error)
	LeaveMatch(context.Context, string, string, string) (matches.Snapshot, error)
	SwitchMatchLanguage(context.Context, string, string, string, string) (workspace.Workspace, error)
}
type MatchEventRepository interface {
	// Publish may be retried after failure; event IDs support deduplication.
	DispatchMatchEvents(context.Context, func(realtime.Notice) error) error
}
type Repository interface {
	ProblemRepository
	QuestionRepository
	ExecutionRepository
	MatchRepository
	MatchEventRepository
	DevelopmentIdentity(context.Context, string) (identity.Principal, error)
}
