package problems

// HintVisibility controls optional disclosures; nil keeps existing session defaults.
type HintVisibility struct {
	Topics     *bool `json:"topics,omitempty"`
	Complexity *bool `json:"complexity,omitempty"`
}

func (h *HintVisibility) TopicsAllowed() bool { return h == nil || h.Topics == nil || *h.Topics }
func (h *HintVisibility) ComplexityAllowed() bool {
	return h != nil && h.Complexity != nil && *h.Complexity
}
