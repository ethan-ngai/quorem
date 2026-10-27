package worker

import (
	"context"
	"time"
)

type executionDeadline interface {
	NextExecutionDeadline(context.Context) (time.Duration, bool, error)
}

// queueTimer schedules actual eligibility; a short floor bounds contention retries.
type queueTimer struct {
	timer *time.Timer
	C     <-chan time.Time
	retry time.Duration
}

func newQueueTimer() *queueTimer {
	timer := time.NewTimer(time.Hour)
	timer.Stop()
	return &queueTimer{timer: timer, retry: 200 * time.Millisecond}
}
func (q *queueTimer) set(delay time.Duration, present bool) {
	if !q.timer.Stop() {
		select {
		case <-q.timer.C:
		default:
		}
	}
	q.C = nil
	if present {
		if delay <= 0 {
			delay = q.retry
			q.retry = min(2*q.retry, 5*time.Second)
		} else {
			q.retry = 200 * time.Millisecond
		}
		if delay < 200*time.Millisecond {
			delay = 200 * time.Millisecond
		}
		q.timer.Reset(delay)
		q.C = q.timer.C
	}
}
func (q *queueTimer) resetBackoff() { q.retry = 200 * time.Millisecond }
func (q *queueTimer) stop()         { q.timer.Stop() }
