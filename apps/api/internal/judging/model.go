package judging

import (
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/ethan-ngai/quorem/internal/execution"
	"time"
)

type Command struct {
	Level       int             `json:"level,omitempty"`
	WorkspaceID string          `json:"workspaceId"`
	Kind        string          `json:"kind"`
	Source      string          `json:"source"`
	CustomCases []problems.Case `json:"customCases,omitempty"`
}
type Submission struct {
	CustomRun           bool                         `json:"customRun,omitempty"`
	PrivateCaseResults  []InterviewCaseResult        `json:"privateCaseResults,omitempty"`
	ExecutionJobID      string                       `json:"-"`
	ID                  string                       `json:"id"`
	WorkspaceID         string                       `json:"workspaceId"`
	Kind                string                       `json:"kind"`
	State               string                       `json:"state"`
	SourceHash          string                       `json:"sourceHash"`
	AdmittedAt          time.Time                    `json:"admittedAt"`
	UpdatedAt           time.Time                    `json:"updatedAt"`
	Verdict             execution.Verdict            `json:"verdict,omitempty"`
	Score               *execution.Score             `json:"score,omitempty"`
	PublicCases         []execution.PublicCaseResult `json:"publicCases,omitempty"`
	HiddenCases         []execution.HiddenCaseResult `json:"hiddenCases,omitempty"`
	Diagnostics         []execution.Diagnostic       `json:"diagnostics,omitempty"`
	InfrastructureError string                       `json:"infrastructureError,omitempty"`
}
type Spec struct {
	SubmitSamples  []problems.Case
	PrivateDetails bool
	Source         string
	Kind           string
	Problem        problems.Problem
	Cases          []problems.Case
}

type InterviewCaseResult struct {
	CaseID string        `json:"caseId"`
	Case   problems.Case `json:"case"`
	execution.PublicCaseResult
}
