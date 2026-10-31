package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/postgres"
	"github.com/ethan-ngai/quorem/apps/api/internal/matches"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
)

// Each HTTP test owns a database; migrations target its public schema.
func streamStore(t *testing.T) *postgres.Store {
	t.Helper()
	ctx := context.Background()
	store := NewHTTPTestDatabase(t)
	root, e := os.Getwd()
	if e != nil {
		t.Fatal(e)
	}
	for {
		if _, e = os.Stat(filepath.Join(root, "go.mod")); e == nil {
			break
		}
		parent := filepath.Dir(root)
		if parent == root {
			t.Fatal("repository root missing")
		}
		root = parent
	}
	if e = store.Migrate(ctx, filepath.Join(root, "apps/api/migrations")); e != nil {
		t.Fatal(e)
	}
	fixtures, e := problems.LoadFixtures(filepath.Join(root, "fixtures/problems"))
	if e != nil {
		t.Fatal(e)
	}
	if e = store.Seed(ctx, fixtures); e != nil {
		t.Fatal(e)
	}
	return store
}

func streamServer(t *testing.T, store *postgres.Store) (*Server, *httptest.Server, func()) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	api := &Server{Store: store, Local: true}
	if err := api.StartRealtime(ctx); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(api.Handler())
	stop := func() { cancel(); server.Close() }
	t.Cleanup(stop)
	return api, server, stop
}

func dialStream(ctx context.Context, server, match, user, origin string) (*websocket.Conn, *http.Response, error) {
	headers := http.Header{}
	if origin != "" {
		headers.Set("Origin", origin)
	}
	return websocket.Dial(ctx, "ws"+strings.TrimPrefix(server, "http")+"/v1/matches/"+match+"/events?user="+user, &websocket.DialOptions{HTTPHeader: headers})
}

func readSnapshot(t *testing.T, conn *websocket.Conn, accept func(matches.Snapshot) bool) matches.Snapshot {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for i := 0; i < 20; i++ {
		_, data, e := conn.Read(ctx)
		if e != nil {
			t.Fatal(e)
		}
		if strings.Contains(string(data), "source") || strings.Contains(string(data), "inviteToken") {
			t.Fatal("private data in event")
		}
		var envelope struct {
			AggregateVersion string           `json:"aggregateVersion"`
			Payload          matches.Snapshot `json:"payload"`
		}
		if e = json.Unmarshal(data, &envelope); e != nil {
			t.Fatal(e)
		}
		if envelope.AggregateVersion != envelope.Payload.Version {
			t.Fatal("coalesced version mismatch")
		}
		if accept(envelope.Payload) {
			return envelope.Payload
		}
	}
	t.Fatal("desired event absent")
	return matches.Snapshot{}
}

func TestPrivateMatchStreamRecoveryAndPublishBoundary(t *testing.T) {
	store := streamStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	created, e := store.CreateMatch(ctx, "alice", postgres.ID(), matches.Settings{Difficulty: "easy", DurationMinutes: 15})
	if e != nil {
		t.Fatal(e)
	}
	_, server, stop := streamServer(t, store)
	for _, probe := range []struct {
		user, origin string
		status       int
	}{{"bob", "http://localhost:5173", 404}, {"alice", "", 401}, {"alice", "https://foreign.example", 403}} {
		conn, response, e := dialStream(ctx, server.URL, created.ID, probe.user, probe.origin)
		if conn != nil {
			conn.CloseNow()
		}
		if e == nil || response == nil || response.StatusCode != probe.status {
			t.Fatalf("unauthorized upgrade: %v %v", response, e)
		}
	}
	alice, _, e := dialStream(ctx, server.URL, created.ID, "alice", "http://localhost:5173")
	if e != nil {
		t.Fatal(e)
	}
	defer alice.CloseNow()
	waiting := readSnapshot(t, alice, func(v matches.Snapshot) bool { return v.State == "waiting" })
	if waiting.ProblemVersionID != "" || waiting.Participants[0].Presence != "online" {
		t.Fatal(waiting)
	}
	token := strings.TrimPrefix(strings.TrimPrefix(created.InviteURL, "http://localhost:5173"), "/invite/")
	if _, e = store.JoinMatch(ctx, "bob", postgres.ID(), token); e != nil {
		t.Fatal(e)
	}
	readSnapshot(t, alice, func(v matches.Snapshot) bool { return len(v.Participants) == 2 })
	if _, e = store.ReadyMatch(ctx, "alice", created.ID, postgres.ID(), true); e != nil {
		t.Fatal(e)
	}
	if _, e = store.ReadyMatch(ctx, "bob", created.ID, postgres.ID(), true); e != nil {
		t.Fatal(e)
	}
	active := readSnapshot(t, alice, func(v matches.Snapshot) bool { return v.State == "active" })
	if active.ProblemVersionID == "" || active.Participants[0].WorkspaceID == "" || active.Participants[1].WorkspaceID != "" {
		t.Fatal("workspace reveal boundary", active)
	}
	if e = alice.Write(ctx, websocket.MessageText, []byte(`{"type":"match.completed"}`)); e != nil {
		t.Fatal(e)
	}
	for {
		_, _, e = alice.Read(ctx)
		if e != nil {
			break
		}
	}
	if websocket.CloseStatus(e) != websocket.StatusPolicyViolation {
		t.Fatal("client publish not denied", e)
	}
	if _, e = store.ForfeitMatch(ctx, "bob", created.ID, postgres.ID()); e != nil {
		t.Fatal(e)
	}
	stop()
	_, restarted, _ := streamServer(t, store)
	reconnect, _, e := dialStream(ctx, restarted.URL, created.ID, "alice", "http://localhost:5173")
	if e != nil {
		t.Fatal(e)
	}
	defer reconnect.CloseNow()
	completed := readSnapshot(t, reconnect, func(v matches.Snapshot) bool { return v.State == "completed" })
	if completed.Outcome == nil || completed.Outcome.WinnerUserID != developmentSubject("alice") {
		t.Fatal(completed)
	}
}

func TestMatchOutboxPublishFailureAndCommitOrder(t *testing.T) {
	store := streamStore(t)
	ctx := context.Background()
	created, e := store.CreateMatch(ctx, "alice", postgres.ID(), matches.Settings{Difficulty: "easy", DurationMinutes: 15})
	if e != nil {
		t.Fatal(e)
	}
	fail := errors.New("publisher unavailable")
	if e = store.DispatchMatchEvents(ctx, func(realtime.Notice) error { return fail }); !errors.Is(e, fail) {
		t.Fatal(e)
	}
	count := 0
	publish := func(realtime.Notice) error { count++; return nil }
	if e = store.DispatchMatchEvents(ctx, publish); e != nil || count != 1 {
		t.Fatal(count, e)
	}
	// A lower sequence committing later must not be skipped by a high-water cursor.
	tx, e := store.Pool.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, "INSERT INTO match_outbox(id,match_id,version,event_type) VALUES($1,$2,20,'match.updated')", postgres.ID(), created.ID); e != nil {
		t.Fatal(e)
	}
	if _, e = store.Pool.Exec(ctx, "INSERT INTO match_outbox(id,match_id,version,event_type) VALUES($1,$2,21,'match.updated')", postgres.ID(), created.ID); e != nil {
		t.Fatal(e)
	}
	if e = store.DispatchMatchEvents(ctx, publish); e != nil || count != 2 {
		t.Fatal(count, e)
	}
	if e = tx.Commit(ctx); e != nil {
		t.Fatal(e)
	}
	if e = store.DispatchMatchEvents(ctx, publish); e != nil || count != 3 {
		t.Fatal(count, e)
	}
	if e = store.DispatchMatchEvents(ctx, publish); e != nil || count != 3 {
		t.Fatal("acknowledged event replay", count, e)
	}
	// A single coalesced wake drains more than one batch without a recovery-tick delay.
	if _, e = store.Pool.Exec(ctx, `INSERT INTO match_outbox(id,match_id,version,event_type) SELECT gen_random_uuid(),$1,version,'match.updated' FROM generate_series(22,171) version`, created.ID); e != nil {
		t.Fatal(e)
	}
	if e = store.DispatchMatchEvents(ctx, publish); e != nil || count != 153 {
		t.Fatal("recovery backlog left after one dispatch", count, e)
	}
}

type revocableVerifier struct{ state atomic.Int32 }

func (v *revocableVerifier) Verify(context.Context, string) (identity.Principal, error) {
	switch v.state.Load() {
	case 1:
		return identity.Principal{}, identity.ErrUnauthorized
	case 2:
		return identity.Principal{UserID: "bob"}, nil
	}
	return identity.Principal{UserID: "alice", SessionID: "managed", EmailVerified: true}, nil
}
func TestManagedStreamReauthorizesDelivery(t *testing.T) {
	for _, state := range []int32{1, 2} {
		t.Run(fmt.Sprintf("state-%d", state), func(t *testing.T) {
			store := streamStore(t)
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			created, e := store.CreateMatch(ctx, "alice", postgres.ID(), matches.Settings{Difficulty: "easy", DurationMinutes: 15})
			if e != nil {
				t.Fatal(e)
			}
			verifier := &revocableVerifier{}
			events := realtime.NewMemory()
			defer events.Close()
			api := &Server{Store: store, Identity: verifier, Events: events, Presence: events, Origins: []string{"http://localhost:5173"}}
			server := httptest.NewServer(api.Handler())
			defer server.Close()
			connection, _, e := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+"/v1/matches/"+created.ID+"/events", &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{"http://localhost:5173"}}, Subprotocols: []string{"quorem", "bearer.signed"}})
			if e != nil {
				t.Fatal(e)
			}
			defer connection.CloseNow()
			if _, _, e = connection.Read(ctx); e != nil {
				t.Fatal(e)
			}
			verifier.state.Store(state)
			if e = events.Publish(ctx, "/matches/"+created.ID, realtime.Notice{AggregateID: created.ID}); e != nil {
				t.Fatal(e)
			}
			_, _, e = connection.Read(ctx)
			if websocket.CloseStatus(e) != websocket.StatusPolicyViolation {
				t.Fatalf("revoked/mismatched identity retained stream: %v", e)
			}
		})
	}
}
