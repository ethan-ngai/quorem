package realtime

import (
	"context"
	"testing"
)

func TestCoalescingAndTopicIsolation(t *testing.T) {
	hub := NewMemory()
	defer hub.Close()
	ctx := context.Background()
	ch, cancel, e := hub.Subscribe(ctx, "a")
	if e != nil {
		t.Fatal(e)
	}
	defer cancel()
	other, stop, e := hub.Subscribe(ctx, "b")
	if e != nil {
		t.Fatal(e)
	}
	defer stop()
	for _, version := range []string{"1", "2", "3"} {
		if e = hub.Publish(ctx, "a", Notice{Version: version}); e != nil {
			t.Fatal(e)
		}
	}
	if n := <-ch; n.Version != "3" {
		t.Fatal(n)
	}
	select {
	case <-other:
		t.Fatal("foreign topic received event")
	default:
	}
	cancel()
	cancel()
	if _, ok := <-ch; ok {
		t.Fatal("unsubscribe left channel open")
	}
}

func TestPresenceCountsAndShutdown(t *testing.T) {
	hub := NewMemory()
	first, e := hub.Connect("match", "alice")
	if e != nil {
		t.Fatal(e)
	}
	second, e := hub.Connect("match", "alice")
	if e != nil {
		t.Fatal(e)
	}
	first()
	first()
	if !hub.Online("match", "alice") {
		t.Fatal("second tab lost presence")
	}
	second()
	if hub.Online("match", "alice") {
		t.Fatal("closed user online")
	}
	ch, stop, e := hub.Subscribe(context.Background(), "match")
	if e != nil {
		t.Fatal(e)
	}
	hub.Close()
	stop()
	hub.Close()
	if _, ok := <-ch; ok {
		t.Fatal("shutdown left subscription open")
	}
	if e = hub.Publish(context.Background(), "match", Notice{}); e == nil {
		t.Fatal("publish after shutdown")
	}
}

func TestInterviewNoticeCoalescing(t *testing.T) {
	document := Notice{Type: "interview.document"}
	presence := Notice{Type: "interview.presence"}
	if CoalesceNotice(document, presence).Type != "interview.changed" {
		t.Fatal("document wakeup lost")
	}
	if CoalesceNotice(document, document).Type != "interview.document" {
		t.Fatal("unnecessary full refresh")
	}
	if CoalesceNotice(CoalesceNotice(document, presence), document).Type != "interview.changed" {
		t.Fatal("full wakeup lost")
	}
}
