package matches

import (
	"context"
	"log"
	"time"
)

type DeadlineRepository interface {
	MatchDeadlineNotifications(context.Context) (<-chan struct{}, func(), error)
	NextMatchDeadline(context.Context) (time.Duration, bool, error)
	ReconcileDueMatches(context.Context) (int, error)
}

// RunDeadlineScheduler listens before reading the earliest durable deadline.
func RunDeadlineScheduler(ctx context.Context, repo DeadlineRepository) {
	var wake <-chan struct{}
	var stop func()
	defer func() {
		if stop != nil {
			stop()
		}
	}()
	connect := func() {
		var err error
		wake, stop, err = repo.MatchDeadlineNotifications(ctx)
		if err != nil {
			wake = nil
			stop = nil
			log.Print("Match deadline notifications unavailable; using bounded recovery")
		}
	}
	connect()
	for ctx.Err() == nil {
		if wake == nil {
			connect()
		}
		count := 0
		failed := false
		for {
			attempt, cancel := context.WithTimeout(ctx, 5*time.Second)
			n, err := repo.ReconcileDueMatches(attempt)
			cancel()
			if err != nil {
				failed = true
				if ctx.Err() == nil {
					log.Print("Match deadline reconciliation unavailable")
				}
				break
			}
			count = n
			if n < 64 {
				break
			}
		}
		var delay time.Duration
		var hasDeadline bool
		if !failed {
			attempt, cancel := context.WithTimeout(ctx, 5*time.Second)
			var err error
			delay, hasDeadline, err = repo.NextMatchDeadline(attempt)
			cancel()
			if err != nil {
				failed = true
				if ctx.Err() == nil {
					log.Print("Match deadline scheduling unavailable")
				}
			}
		}
		// Lost LISTEN sessions and query errors retain bounded recovery, not an idle scan.
		if wake == nil || failed {
			delay, hasDeadline = time.Second, true
		}
		if hasDeadline && delay < 0 {
			delay = 0
		}
		// Another replica can hold a due row; avoid spinning until its transaction commits.
		if hasDeadline && delay == 0 && count == 0 {
			delay = 100 * time.Millisecond
		}
		var timer *time.Timer
		var timerC <-chan time.Time
		if hasDeadline {
			timer = time.NewTimer(delay)
			timerC = timer.C
		}
		select {
		case <-ctx.Done():
		case <-timerC:
		case _, open := <-wake:
			if !open {
				if stop != nil {
					stop()
					stop = nil
				}
				wake = nil
			}
		}
		if timer != nil {
			timer.Stop()
		}
	}
}
