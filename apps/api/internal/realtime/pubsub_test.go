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
	first := hub.Connect("match", "alice")
	second := hub.Connect("match", "alice")
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
