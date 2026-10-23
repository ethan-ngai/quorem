package matches

import (
	"github.com/ethan-ngai/quorem/internal/execution"
	"time"
)

const Showdown = "showdown"
const FreeForAll = "free-for-all"

// InvitePreview discloses lobby settings only, never participant identities or problem content.
type InvitePreview struct {
	ID               string   `json:"id"`
	AdmissionLocked  bool     `json:"admissionLocked"`
	AccessMode       string   `json:"accessMode"`
	Mode             string   `json:"mode"`
	Difficulties     []string `json:"difficulties"`
	DurationMinutes  int      `json:"durationMinutes"`
	Rules            Rules    `json:"rules"`
	ParticipantCount int      `json:"participantCount"`
	Capacity         int      `json:"capacity"`
}

type Rules struct {
	Clipboard string `json:"clipboard"`
	Focus     string `json:"focus"`
}
type RuleEvent struct {
	ID         string    `json:"id"`
	UserID     string    `json:"userId"`
	Kind       string    `json:"kind"`
	Action     string    `json:"action"`
	OccurredAt time.Time `json:"occurredAt"`
}

type Settings struct {
	AdmissionLocked          bool     `json:"admissionLocked"`
	AccessMode               string   `json:"accessMode"`
	Mode                     string   `json:"mode"`
	Difficulties             []string `json:"difficulties"`
	SelectedProblemVersionID string   `json:"selectedProblemVersionId,omitempty"`
	Rules                    Rules    `json:"rules"`
	Difficulty               string   `json:"difficulty"`
	DurationMinutes          int      `json:"durationMinutes"`
}

func (s Settings) Normalize() Settings {
	if s.AccessMode == "" {
		s.AccessMode = "accounts_only"
	}
	if s.Mode == "" {
		s.Mode = Showdown
	}
	if s.DurationMinutes == 0 {
		s.DurationMinutes = 30
	}
	if len(s.Difficulties) == 0 {
		if s.Difficulty == "" && s.SelectedProblemVersionID != "" {
			s.Difficulty = "easy"
		}
		s.Difficulties = []string{s.Difficulty}
	}
	s.Difficulty = s.Difficulties[0]
	if s.Rules.Clipboard == "" {
		s.Rules.Clipboard = "off"
	}
	if s.Rules.Focus == "" {
		s.Rules.Focus = "off"
	}
	return s
}
func (s Settings) Capacity() int {
	if s.Mode == FreeForAll {
		return 8
	}
	return 2
}
func (s Settings) Valid() bool {
	if s.AccessMode != "accounts_only" && s.AccessMode != "guests_allowed" {
		return false
	}
	if s.Mode != Showdown && s.Mode != FreeForAll {
		return false
	}
	if len(s.Difficulties) < 1 || len(s.Difficulties) > 3 {
		return false
	}
	seen := map[string]bool{}
	for _, d := range s.Difficulties {
		if seen[d] || (d != "easy" && d != "medium" && d != "hard") {
			return false
		}
		seen[d] = true
	}
	for _, a := range []string{s.Rules.Clipboard, s.Rules.Focus} {
		if a != "off" && a != "warning" && a != "announce" {
			return false
		}
	}
	return (s.Difficulty == "easy" || s.Difficulty == "medium" || s.Difficulty == "hard") && (s.DurationMinutes == 15 || s.DurationMinutes == 30 || s.DurationMinutes == 45 || s.DurationMinutes == 60)
}

type Created struct {
	ID        string `json:"id"`
	InviteURL string `json:"inviteUrl"`
	State     string `json:"state"`
}
type Participant struct {
	Guest           bool             `json:"guest"`
	Forfeited       bool             `json:"forfeited"`
	UserID          string           `json:"userId"`
	DisplayName     string           `json:"displayName"`
	Ready           bool             `json:"ready"`
	Presence        string           `json:"presence"`
	SubmissionState string           `json:"submissionState,omitempty"`
	BestScore       *execution.Score `json:"bestScore,omitempty"`
	WorkspaceID     string           `json:"workspaceId,omitempty"`
}
type Outcome struct {
	Kind         string    `json:"kind"`
	WinnerUserID string    `json:"winnerUserId,omitempty"`
	Reason       string    `json:"reason"`
	CompletedAt  time.Time `json:"completedAt"`
}
type Snapshot struct {
	ID         string    `json:"id"`
	Version    string    `json:"version"`
	State      string    `json:"state"`
	ServerNow  time.Time `json:"serverNow"`
	HostUserID string    `json:"hostUserId"`
	ExpiresAt  time.Time `json:"expiresAt"`
	Settings
	RuleEvents       []RuleEvent   `json:"ruleEvents"`
	Participants     []Participant `json:"participants"`
	StartedAt        *time.Time    `json:"startedAt,omitempty"`
	Deadline         *time.Time    `json:"deadline,omitempty"`
	FinalizingAt     *time.Time    `json:"finalizingAt,omitempty"`
	ProblemVersionID string        `json:"problemVersionId,omitempty"`
	Outcome          *Outcome      `json:"outcome,omitempty"`
}
