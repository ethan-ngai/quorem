package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/postgres"
	"github.com/ethan-ngai/quorem/apps/api/internal/application"
	"github.com/ethan-ngai/quorem/apps/api/internal/matches"
	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
)

type inviteStreamRepository struct {
	Repository
	revoked atomic.Bool
	reads   atomic.Int32
}

func TestInviteStreamReceivesCommittedMatchChanges(t *testing.T) {
	store := streamStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	created, err := store.CreateMatch(ctx, "alice", postgres.ID(), matches.Settings{Difficulty: "easy"})
	if err != nil {
		t.Fatal(err)
	}
	_, server, _ := streamServer(t, store)
	token := strings.TrimPrefix(created.InviteURL, "/invite/")
	address := "ws" + strings.TrimPrefix(server.URL, "http") + "/v1/match-invites/" + token + "/events"
	conn, _, err := websocket.Dial(ctx, address, &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {"http://localhost:5173"}}})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	if _, _, err = conn.Read(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err = store.JoinMatch(ctx, "bob", postgres.ID(), token); err != nil {
		t.Fatal(err)
	}
	if _, data, err := conn.Read(ctx); err != nil || string(data) != `{"type":"changed"}` {
		t.Fatalf("committed notice: %q %v", data, err)
	}
}

func (r *inviteStreamRepository) PreviewInvite(_ context.Context, token string) (matches.InvitePreview, error) {
	r.reads.Add(1)
	if r.revoked.Load() || token != strings.Repeat("A", 43) {
		return matches.InvitePreview{}, &application.Error{Code: "not_found", Status: 404}
	}
	return matches.InvitePreview{ID: "e994c7a7-642b-4f38-a1ed-000000000194"}, nil
}

func TestInviteHeartbeatDoesNotReadPreviewAndReconnectPromptsRefresh(t *testing.T) {
	repo := &inviteStreamRepository{}
	events := realtime.NewMemory()
	defer events.Close()
	api := &Server{Store: repo, Events: events, Origins: []string{"https://quorem.test"}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.SetPathValue("token", strings.Repeat("A", 43))
		api.servePreviewInviteEvents(w, r, 10*time.Millisecond)
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	connect := func() *websocket.Conn {
		t.Helper()
		c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http"), &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {"https://quorem.test"}}})
		if err != nil {
			t.Fatal(err)
		}
		return c
	}
	read := func(c *websocket.Conn, want string) {
		t.Helper()
		_, data, err := c.Read(ctx)
		if err != nil || string(data) != want {
			t.Fatalf("frame=%s error=%v", data, err)
		}
	}
	first := connect()
	read(first, `{"type":"changed"}`)
	read(first, `{"type":"heartbeat"}`)
	read(first, `{"type":"heartbeat"}`)
	if repo.reads.Load() != 1 {
		t.Fatalf("heartbeat re-read preview %d times", repo.reads.Load())
	}
	first.CloseNow()
	second := connect()
	defer second.CloseNow()
	read(second, `{"type":"changed"}`)
	if repo.reads.Load() != 2 {
		t.Fatalf("reconnect did not reauthorize preview: %d", repo.reads.Load())
	}
}

func TestInviteStreamNotifiesAndRevokes(t *testing.T) {
	repo := &inviteStreamRepository{}
	events := realtime.NewMemory()
	server := httptest.NewServer((&Server{Store: repo, Events: events, Origins: []string{"https://quorem.test"}}).Handler())
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	address := "ws" + strings.TrimPrefix(server.URL, "http") + "/v1/match-invites/" + strings.Repeat("A", 43) + "/events"
	conn, _, err := websocket.Dial(ctx, address, &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {"https://quorem.test"}}})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	read := func() {
		t.Helper()
		_, data, err := conn.Read(ctx)
		if err != nil || string(data) != `{"type":"changed"}` {
			t.Fatalf("notice %q: %v", data, err)
		}
	}
	read()
	if err = events.Publish(ctx, "/match-invites/e994c7a7-642b-4f38-a1ed-000000000194", realtime.Notice{}); err != nil {
		t.Fatal(err)
	}
	read()
	repo.revoked.Store(true)
	if err = events.Publish(ctx, "/match-invites/e994c7a7-642b-4f38-a1ed-000000000194", realtime.Notice{}); err != nil {
		t.Fatal(err)
	}
	read()
	if _, _, err = conn.Read(ctx); err == nil {
		t.Fatal("revoked invitation remained subscribed")
	}
	_, response, err := websocket.Dial(ctx, address, &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {"https://quorem.test"}}})
	if err == nil || response == nil || response.StatusCode != 404 {
		t.Fatalf("revoked connection: %v %v", response, err)
	}
}
