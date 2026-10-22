// Package delivery carries execution wake-ups; PostgreSQL owns job state and leases.
package delivery

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

const MaxBatch = 10

var ErrInvalid = errors.New("invalid queue notification")
var ErrUnavailable = errors.New("notification queue unavailable")

// Notification contains no source code, identity credentials, or lease authority.
type Notification struct {
	JobID string `json:"jobId"`
}
type Message struct {
	Notification Notification
	Receipt      string
}

// Queue provides at-least-once notifications; delivery order is unspecified.
// Consumers retain database polling to recover missed publishes and expired messages.
// Receipt is opaque and valid only for its provider's visibility window.
type Queue interface {
	Publish(context.Context, Notification) error
	Receive(context.Context, int) ([]Message, error)
	Ack(context.Context, string) error
	Retry(context.Context, string, time.Duration) error
}

func encode(n Notification) (string, error) {
	if n.JobID == "" || len(n.JobID) > 128 {
		return "", ErrInvalid
	}
	data, err := json.Marshal(n)
	return string(data), err
}
func decode(body string) (Notification, error) {
	var n Notification
	if len(body) > 1024 || json.Unmarshal([]byte(body), &n) != nil {
		return n, ErrInvalid
	}
	_, err := encode(n)
	return n, err
}
func validLimit(limit int) bool { return limit >= 1 && limit <= MaxBatch }
func validDelay(delay time.Duration) bool {
	return delay >= 0 && delay <= 12*time.Hour && delay%time.Second == 0
}
