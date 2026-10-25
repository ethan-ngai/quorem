package interviews

import (
	"encoding/json"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
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
type QuestionInput struct {
	ProblemVersionID string          `json:"problemVersionId,omitempty"`
	Custom           *CustomQuestion `json:"custom,omitempty"`
	Language         string          `json:"language"`
}
type Create struct {
	Title    string        `json:"title"`
	Question QuestionInput `json:"question"`
}
type Member struct {
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
	QuestionEpoch      string       `json:"questionEpoch"`
	Invites            *InvitePaths `json:"invites,omitempty"`
	LatestSubmissionID string       `json:"latestSubmissionId,omitempty"`
	ID                 string       `json:"id"`
	Title              string       `json:"title"`
	State              string       `json:"state"`
	HostID             string       `json:"hostId"`
	Role               string       `json:"role"`
	Members            []Member     `json:"members"`
	Question           Question     `json:"question"`
	Document           Document     `json:"document"`
	InvitePath         string       `json:"invitePath,omitempty"`
	Version            int64        `json:"version"`
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

type Progress struct {
	TotalLevels int                     `json:"totalLevels"`
	Level       int                     `json:"level"`
	Completed   bool                    `json:"completed"`
	Levels      []problems.OdysseyLevel `json:"levels"`
}
type PresenceInput struct {
	ClientID string `json:"clientID"`
	Epoch    string `json:"epoch"`
	Version  int64  `json:"version"`
	Anchor   int    `json:"anchor"`
	Head     int    `json:"head"`
}
type Presence struct {
	PresenceInput
	UserID string `json:"userId"`
	Name   string `json:"name"`
}

type InvitePaths struct {
	Interviewer string `json:"interviewer"`
	Interviewee string `json:"interviewee"`
}
type CaseDetail struct {
	ID       string        `json:"id"`
	Case     problems.Case `json:"case"`
	Revealed bool          `json:"revealed"`
}
