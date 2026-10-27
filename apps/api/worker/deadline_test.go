package worker

import (
	"testing"
	"time"
)

func TestDueDeadlineContentionBacksOffAndResets(t *testing.T) {
	timer := newQueueTimer()
	defer timer.stop()
	for _, minimum := range []time.Duration{180 * time.Millisecond, 350 * time.Millisecond, 700 * time.Millisecond} {
		start := time.Now()
		timer.set(0, true)
		<-timer.C
		if elapsed := time.Since(start); elapsed < minimum {
			t.Fatalf("retry too fast: %s < %s", elapsed, minimum)
		}
	}
	timer.resetBackoff()
	start := time.Now()
	timer.set(0, true)
	<-timer.C
	if elapsed := time.Since(start); elapsed < 180*time.Millisecond || elapsed > time.Second {
		t.Fatalf("notification did not reset retry: %s", elapsed)
	}
}
