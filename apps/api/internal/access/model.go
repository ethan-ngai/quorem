package access

import "time"

// Capabilities are product benefits; admin remains a separate authorization role.
type Capabilities struct {
	HostGuests         bool `json:"hostGuests"`
	HostedIntelligence bool `json:"hostedIntelligence"`
	Experimental       bool `json:"experimental"`
	GuestJobs          int  `json:"guestJobs"`
	GuestSeconds       int  `json:"guestSeconds"`
	GuestConcurrency   int  `json:"guestConcurrency"`
}
type Grant struct {
	ExpiresAt   *time.Time `json:"expiresAt,omitempty"`
	OperationID string     `json:"operationId"`
	UserID      string     `json:"userId"`
	Actor       string     `json:"actor"`
	Reason      string     `json:"reason"`
	Scope       string     `json:"scope"`
	Source      string     `json:"source"`
	Reference   string     `json:"reference"`
	Revoke      bool       `json:"revoke"`
}
