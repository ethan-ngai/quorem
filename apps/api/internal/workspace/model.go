package workspace

import "time"

type Draft struct {
	Source   string    `json:"source"`
	Revision string    `json:"revision"`
	SavedAt  time.Time `json:"savedAt"`
}
type Workspace struct {
	ID               string         `json:"id"`
	MatchID          string         `json:"matchId,omitempty"`
	Kind             string         `json:"kind"`
	ProblemVersionID string         `json:"problemVersionId"`
	Language         string         `json:"language"`
	Draft            Draft          `json:"draft"`
	Preferences      map[string]any `json:"preferences"`
}
type History struct {
	Items      []Draft `json:"items"`
	NextCursor string  `json:"nextCursor,omitempty"`
}
