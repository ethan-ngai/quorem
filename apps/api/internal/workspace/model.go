package workspace

type Workspace struct {
	ID               string         `json:"id"`
	MatchID          string         `json:"matchId,omitempty"`
	Kind             string         `json:"kind"`
	ProblemVersionID string         `json:"problemVersionId"`
	Language         string         `json:"language"`
	Preferences      map[string]any `json:"preferences"`
}
