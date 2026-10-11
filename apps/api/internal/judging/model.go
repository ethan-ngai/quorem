package judging

import (
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/ethan-ngai/quorem/internal/execution"
	"time"
)

type Command struct {
	WorkspaceID string          `json:"workspaceId"`
	Kind        string          `json:"kind"`
	Source      string          `json:"source"`
	CustomCases []problems.Case `json:"customCases,omitempty"`
}
type Submission struct {
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
	Source  string
	Kind    string
	Fixture problems.Fixture
	Cases   []problems.Case
}
