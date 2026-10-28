package execution

import "time"

const (
	AttemptTimeout    = 120 * time.Second
	TeardownTimeout   = 30 * time.Second
	CompletionTimeout = 5 * time.Second
)
