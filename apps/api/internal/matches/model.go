package matches

import (
	"github.com/ethan-ngai/quorem/internal/execution"
	"time"
)

const Showdown = "showdown"

type Settings struct {
	Difficulty      string `json:"difficulty"`
	DurationMinutes int    `json:"durationMinutes"`
}

func (s Settings) Valid() bool {
	return (s.Difficulty == "easy" || s.Difficulty == "medium" || s.Difficulty == "hard") && (s.DurationMinutes == 15 || s.DurationMinutes == 30 || s.DurationMinutes == 45 || s.DurationMinutes == 60)
}

type Created struct {
	ID        string `json:"id"`
	InviteURL string `json:"inviteUrl"`
	State     string `json:"state"`
}
type Participant struct {
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
	Mode       string    `json:"mode"`
	ID         string    `json:"id"`
	Version    string    `json:"version"`
	State      string    `json:"state"`
	ServerNow  time.Time `json:"serverNow"`
	HostUserID string    `json:"hostUserId"`
	ExpiresAt  time.Time `json:"expiresAt"`
	Settings
	Participants     []Participant `json:"participants"`
	StartedAt        *time.Time    `json:"startedAt,omitempty"`
	Deadline         *time.Time    `json:"deadline,omitempty"`
	FinalizingAt     *time.Time    `json:"finalizingAt,omitempty"`
	ProblemVersionID string        `json:"problemVersionId,omitempty"`
	Outcome          *Outcome      `json:"outcome,omitempty"`
}
