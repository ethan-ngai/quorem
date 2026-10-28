package interviews

import (
	"encoding/json"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"time"
)

const MaxSourceBytes = 65536

type CustomQuestion struct {
	Odyssey            *problems.Odyssey  `json:"odyssey,omitempty"`
	OdysseyHiddenCases [][]problems.Case  `json:"odysseyHiddenCases,omitempty"`
	Title              string             `json:"title"`
	StatementMarkdown  string             `json:"statementMarkdown"`
	Signature          problems.Signature `json:"signature"`
	StarterSource      string             `json:"starterSource"`
	PublicCases        []problems.Case    `json:"publicCases"`
	PrivateCases       []problems.Case    `json:"privateCases"`
}
type ExecutionCommand struct {
	Kind          string          `json:"kind"`
	Level         int             `json:"level"`
	CustomCases   []problems.Case `json:"customCases,omitempty"`
	QuestionEpoch string          `json:"questionEpoch"`
	DocumentEpoch string          `json:"documentEpoch"`
	SourceHash    string          `json:"sourceHash"`
}
type QuestionInput struct {
	Hints            *problems.HintVisibility `json:"hints,omitempty"`
	ProblemVersionID string                   `json:"problemVersionId,omitempty"`
	Custom           *CustomQuestion          `json:"custom,omitempty"`
	Language         string                   `json:"language"`
}
type Create struct {
	Monitoring *Monitoring   `json:"monitoring,omitempty"`
	Title      string        `json:"title"`
	Question   QuestionInput `json:"question"`
}
type Member struct {
	Color  int    `json:"color,omitempty"`
	Image  string `json:"image,omitempty"`
	UserID string `json:"userId"`
	Name   string `json:"name"`
	Role   string `json:"role"`
	Guest  bool   `json:"guest"`
}
type Document struct {
	Source  string `json:"source"`
	Version int64  `json:"version"`
	Epoch   string `json:"epoch"`
}
type Question struct {
	Languages          []string         `json:"languages"`
	PrivateCaseDetails []CaseDetail     `json:"privateCaseDetails,omitempty"`
	RevealedCases      []CaseDetail     `json:"revealedCases,omitempty"`
	Progress           *Progress        `json:"progress,omitempty"`
	Problem            problems.Problem `json:"problem"`
	Language           string           `json:"language"`
	PrivateCases       []problems.Case  `json:"privateCases,omitempty"`
}
type Snapshot struct {
	AdmissionLocked    bool                     `json:"admissionLocked"`
	Monitoring         Monitoring               `json:"monitoring"`
	RuleEvents         []RuleEvent              `json:"ruleEvents,omitempty"`
	Hints              *problems.HintVisibility `json:"hints,omitempty"`
	QuestionEpoch      string                   `json:"questionEpoch"`
	Invites            *InvitePaths             `json:"invites,omitempty"`
	LatestSubmissionID string                   `json:"latestSubmissionId,omitempty"`
	ID                 string                   `json:"id"`
	Title              string                   `json:"title"`
	State              string                   `json:"state"`
	HostID             string                   `json:"hostId"`
	Role               string                   `json:"role"`
	Members            []Member                 `json:"members"`
	Question           Question                 `json:"question"`
	Document           Document                 `json:"document"`
	InvitePath         string                   `json:"invitePath,omitempty"`
	Version            int64                    `json:"version"`
}
type Update struct {
	ClientID string          `json:"clientID"`
	Changes  json.RawMessage `json:"changes"`
}
type Push struct {
	Version int64    `json:"version"`
	Epoch   string   `json:"epoch"`
	Updates []Update `json:"updates"`
}
type Updates struct {
	Version int64    `json:"version"`
	Epoch   string   `json:"epoch"`
	Updates []Update `json:"updates"`
}
type Preview struct {
	Role      string `json:"role"`
	Title     string `json:"title"`
	SessionID string `json:"sessionId"`
	State     string `json:"state"`
}

type Progress = problems.OdysseyProgress

type PresenceInput struct {
	ClientID string `json:"clientID"`
	Epoch    string `json:"epoch"`
	Version  int64  `json:"version"`
	Anchor   int    `json:"anchor"`
	Head     int    `json:"head"`
}
type Presence struct {
	Color int `json:"color,omitempty"`
	PresenceInput
	UserID string `json:"userId"`
	Name   string `json:"name"`
}

type InvitePaths struct {
	Interviewer string `json:"interviewer"`
	Interviewee string `json:"interviewee"`
}
type CaseDetail struct {
	Status   string        `json:"status,omitempty"`
	ID       string        `json:"id"`
	Case     problems.Case `json:"case"`
	Revealed bool          `json:"revealed"`
}

// Omitted flags preserve default-on observation for existing and new sessions.
type Monitoring struct {
	Paste *bool `json:"paste,omitempty"`
	Focus *bool `json:"focus,omitempty"`
}

func (m Monitoring) PasteEnabled() bool { return m.Paste == nil || *m.Paste }
func (m Monitoring) FocusEnabled() bool { return m.Focus == nil || *m.Focus }

type RuleEvent struct {
	ID         string    `json:"id"`
	UserID     string    `json:"userId"`
	Name       string    `json:"name"`
	Kind       string    `json:"kind"`
	OccurredAt time.Time `json:"occurredAt"`
}
