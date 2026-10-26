package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/eventbus"
	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/postgres"
	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
)

func interviewRPC(t *testing.T, c *websocket.Conn, kind string, body map[string]any) json.RawMessage {
	t.Helper()
	if body == nil {
		body = map[string]any{}
	}
	id := postgres.ID()
	body["id"] = id
	body["type"] = kind
	ctx, stop := context.WithTimeout(context.Background(), 5*time.Second)
	defer stop()
	data, _ := json.Marshal(body)
	if err := c.Write(ctx, websocket.MessageText, data); err != nil {
		t.Fatal(err)
	}
	for {
		_, data, err := c.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var frame struct {
			ID    string
			Value json.RawMessage
			Error json.RawMessage
		}
		if json.Unmarshal(data, &frame) != nil {
			t.Fatal("bad frame")
		}
		if frame.ID == id {
			if len(frame.Error) > 0 {
				t.Fatalf("RPC %s: %s", kind, frame.Error)
			}
			return frame.Value
		}
	}
}

func TestInterviewWebSocketCrossInstanceRecovery(t *testing.T) {
	for _, provider := range []string{"memory", "appsync", "cloudflare"} {
		t.Run(provider, func(t *testing.T) {
			var bus realtime.PubSub = realtime.NewMemory()
			if provider == "appsync" {
				bus = interviewAppSyncFixture(t)
			}
			if provider == "cloudflare" {
				if os.Getenv("QUOREM_RELAY_TEST_URL") == "" {
					t.Skip("requires Wrangler")
				}
				bus = &eventbus.Cloudflare{URL: os.Getenv("QUOREM_RELAY_TEST_URL"), Token: os.Getenv("QUOREM_RELAY_TEST_TOKEN")}
			}
			store := streamStore(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if _, err := store.Pool.Exec(ctx, `INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES(gen_random_uuid(),'alice','interviews.host','manual','ws','test','test'),(gen_random_uuid(),'alice','questions.custom','manual','ws','test','test')`); err != nil {
				t.Fatal(err)
			}
			question := interviews.QuestionInput{Language: "python", Custom: &interviews.CustomQuestion{Title: "Increment", StatementMarkdown: "Increment n.", Signature: problems.Signature{ClassName: "Solution", MethodName: "increment", Parameters: []problems.Parameter{{Name: "n", Type: "int"}}, ReturnType: "int"}, StarterSource: "", PublicCases: []problems.Case{{Args: []json.RawMessage{json.RawMessage(`1`)}, Expected: json.RawMessage(`2`)}}, PrivateCases: []problems.Case{{Args: []json.RawMessage{json.RawMessage(`987654`)}, Expected: json.RawMessage(`987655`)}}}}
			question.Custom.StarterSource = "class Solution:\n    def increment(self, n):\n        pass\n"
			pad, err := store.CreateInterview(ctx, "alice", postgres.ID(), interviews.Create{Title: "WS test", Question: question})
			if err != nil {
				t.Fatal(err)
			}
			if _, err = store.JoinInterview(ctx, "bob", strings.TrimPrefix(pad.InvitePath, "/interview-invite/"), "", ""); err != nil {
				t.Fatal(err)
			}

			var before, after int
			if err = store.Pool.QueryRow(ctx, "SELECT count(*) FROM interview_outbox WHERE session_id=$1 AND published_at IS NULL", pad.ID).Scan(&before); err != nil {
				t.Fatal(err)
			}
			if err = store.DispatchInterviewEvents(ctx, func(realtime.Notice) error { return errors.New("provider unavailable") }); err == nil {
				t.Fatal("failed publish acknowledged")
			}
			if err = store.Pool.QueryRow(ctx, "SELECT count(*) FROM interview_outbox WHERE session_id=$1 AND published_at IS NULL", pad.ID).Scan(&after); err != nil || before != after || before == 0 {
				t.Fatal("pending notices lost", before, after, err)
			}
			tx, err := store.Pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = tx.Exec(ctx, "UPDATE interviews SET source=source||'rollback' WHERE id=$1", pad.ID); err != nil {
				t.Fatal(err)
			}
			if err = tx.Rollback(ctx); err != nil {
				t.Fatal(err)
			}
			if err = store.Pool.QueryRow(ctx, "SELECT count(*) FROM interview_outbox WHERE session_id=$1", pad.ID).Scan(&after); err != nil || before != after {
				t.Fatal("rolled-back source emitted a notice")
			}
			servers := []*httptest.Server{}
			for range 2 {
				api := &Server{Store: store, Local: true, Events: bus}
				api.StartRealtime(ctx)
				server := httptest.NewServer(api.Handler())
				servers = append(servers, server)
				defer server.Close()
			}
			dial := func(server *httptest.Server, user, origin string) (*websocket.Conn, *http.Response, error) {
				return websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+"/v1/interviews/"+pad.ID+"/events", &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{origin}, "X-Dev-User": []string{user}}})
			}
			if conn, response, e := dial(servers[0], "charlie", "http://localhost:5173"); e == nil {
				conn.CloseNow()
				t.Fatal("nonmember admitted")
			} else if response.StatusCode != 404 {
				t.Fatalf("nonmember status %d", response.StatusCode)
			}
			if conn, _, e := dial(servers[0], "alice", "https://evil.example"); e == nil {
				conn.CloseNow()
				t.Fatal("foreign origin admitted")
			}
			alice, _, err := dial(servers[0], "alice", "http://localhost:5173")
			if err != nil {
				t.Fatal(err)
			}
			defer alice.CloseNow()
			bob, _, err := dial(servers[1], "bob", "http://localhost:5173")
			if err != nil {
				t.Fatal(err)
			}
			defer bob.CloseNow()
			snapshot := interviewRPC(t, bob, "snapshot", nil)
			if strings.Contains(string(snapshot), "987654") {
				t.Fatal("private tests leaked")
			}
			push := interviews.Push{Epoch: pad.Document.Epoch, Version: 0, Updates: []interviews.Update{{ClientID: "alice-window"}}}
			// CodeMirror ChangeSet retains the existing UTF-16 document after an insertion.
			encoded, _ := json.Marshal([]any{[]any{0, "# shared", ""}, len(pad.Document.Source)})
			push.Updates[0].Changes = encoded
			key := postgres.ID()
			first := interviewRPC(t, alice, "push", map[string]any{"key": key, "push": push})
			replay := interviewRPC(t, alice, "push", map[string]any{"key": key, "push": push})
			if string(first) != string(replay) {
				t.Fatal("retry changed acknowledgement")
			}
			// Wait for the other API instance's provider subscription, not a recovery timer.
			wait, stop := context.WithTimeout(ctx, 3*time.Second)
			defer stop()
			for {
				_, data, e := bob.Read(wait)
				if e != nil {
					t.Fatal("fanout notice missing", e)
				}
				if strings.Contains(string(data), `"changed"`) {
					break
				}
			}
			var updates interviews.Updates
			if err = json.Unmarshal(interviewRPC(t, bob, "pull", map[string]any{"epoch": pad.Document.Epoch, "version": 0}), &updates); err != nil || updates.Version != 1 || len(updates.Updates) != 1 {
				t.Fatalf("cross-instance update: %+v %v", updates, err)
			}

			eventKey := postgres.ID()
			interviewRPC(t, bob, "rule-event", map[string]any{"key": eventKey, "kind": "paste"})
			interviewRPC(t, bob, "rule-event", map[string]any{"key": eventKey, "kind": "paste"})
			var alerts interviews.Snapshot
			if err = json.Unmarshal(interviewRPC(t, alice, "snapshot", nil), &alerts); err != nil || len(alerts.RuleEvents) != 1 {
				t.Fatalf("interviewer socket missing alerts: %v", err)
			}
			if raw := interviewRPC(t, bob, "snapshot", nil); strings.Contains(string(raw), "ruleEvents") || strings.Contains(string(raw), alerts.RuleEvents[0].ID) {
				t.Fatal("candidate socket leaked alerts")
			}
			peers := interviewRPC(t, alice, "presence", map[string]any{"presence": interviews.PresenceInput{ClientID: "alice-window", Epoch: pad.Document.Epoch, Version: 1, Anchor: 1, Head: 1}})
			if !strings.Contains(string(peers), "alice-window") {
				t.Fatal("presence missing")
			}
			if _, err = store.SetInterviewMember(ctx, "alice", pad.ID, postgres.ID(), "bob", "interviewer"); err != nil {
				t.Fatal(err)
			}
			if promoted := string(interviewRPC(t, bob, "snapshot", nil)); !strings.Contains(promoted, "987654") || !strings.Contains(promoted, "ruleEvents") {
				t.Fatal("promotion not reflected")
			}
			if _, err = store.SetInterviewMember(ctx, "alice", pad.ID, postgres.ID(), "bob", "interviewee"); err != nil {
				t.Fatal(err)
			}
			if demoted := string(interviewRPC(t, bob, "snapshot", nil)); strings.Contains(demoted, "987654") || strings.Contains(demoted, "ruleEvents") {
				t.Fatal("demotion leaked private tests")
			}
			bob.CloseNow()
			bob, _, err = dial(servers[1], "bob", "http://localhost:5173")
			if err != nil {
				t.Fatal(err)
			}
			defer bob.CloseNow()
			if err = json.Unmarshal(interviewRPC(t, bob, "pull", map[string]any{"epoch": pad.Document.Epoch, "version": 0}), &updates); err != nil || updates.Version != 1 {
				t.Fatal("reconnect failed")
			}
			if _, err = store.RemoveInterviewMember(ctx, "alice", pad.ID, postgres.ID(), "bob"); err != nil {
				t.Fatal(err)
			}
			revoked, finish := context.WithTimeout(ctx, 3*time.Second)
			defer finish()
			for {
				_, _, e := bob.Read(revoked)
				if e != nil {
					if websocket.CloseStatus(e) != websocket.StatusPolicyViolation {
						t.Fatal("revoked socket not closed", e)
					}
					break
				}
			}
			if _, err = store.Pool.Exec(ctx, "DELETE FROM interviews WHERE id=$1", pad.ID); err != nil {
				t.Fatal("cascade cleanup failed", err)
			}
		})
	}
}

// Exercises the production adapter against AppSync's HTTP/WS protocol on separate API instances.
func interviewAppSyncFixture(t *testing.T) realtime.PubSub {
	hub := realtime.NewMemory()
	t.Cleanup(hub.Close)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" {
			var body struct {
				Channel string
				Events  []string
			}
			if json.NewDecoder(r.Body).Decode(&body) != nil {
				w.WriteHeader(400)
				return
			}
			if r.Header.Get("x-api-key") != "server-only" {
				w.WriteHeader(401)
				return
			}
			for _, event := range body.Events {
				var n realtime.Notice
				if json.Unmarshal([]byte(event), &n) != nil {
					w.WriteHeader(400)
					return
				}
				if hub.Publish(r.Context(), body.Channel, n) != nil {
					w.WriteHeader(503)
					return
				}
			}
			w.Write([]byte(`{"successful":[{"index":0}],"failed":[]}`))
			return
		}
		c, err := websocket.Accept(w, r, &websocket.AcceptOptions{Subprotocols: []string{"aws-appsync-event-ws"}})
		if err != nil {
			return
		}
		defer c.CloseNow()
		ctx := r.Context()
		send := func(value any) error {
			body, _ := json.Marshal(value)
			return c.Write(ctx, websocket.MessageText, body)
		}
		if _, _, err = c.Read(ctx); err != nil {
			return
		}
		if send(map[string]any{"type": "connection_ack", "connectionTimeoutMs": 300000}) != nil {
			return
		}
		_, body, err := c.Read(ctx)
		if err != nil {
			return
		}
		var sub struct{ ID, Channel string }
		if json.Unmarshal(body, &sub) != nil {
			return
		}
		notices, stop, err := hub.Subscribe(ctx, sub.Channel)
		if err != nil {
			return
		}
		defer stop()
		if send(map[string]any{"type": "subscribe_success", "id": sub.ID}) != nil {
			return
		}
		closed := c.CloseRead(ctx)
		for {
			select {
			case <-closed.Done():
				return
			case n, ok := <-notices:
				if !ok {
					return
				}
				encoded, _ := json.Marshal(n)
				if send(map[string]any{"type": "data", "id": sub.ID, "event": []string{string(encoded)}}) != nil {
					return
				}
			}
		}
	}))
	t.Cleanup(server.Close)
	return &eventbus.AppSync{HTTPURL: server.URL, WebSocketURL: strings.Replace(server.URL, "http", "ws", 1), APIKey: "server-only"}
}

func TestInterviewSocketReadsContinueWhileDocumentWriteWaits(t *testing.T) {
	store := streamStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if _, err := store.Pool.Exec(ctx, `INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES(gen_random_uuid(),'alice','interviews.host','manual','concurrent','test','test'),(gen_random_uuid(),'alice','questions.custom','manual','concurrent','test','test')`); err != nil {
		t.Fatal(err)
	}
	q := interviews.QuestionInput{Language: "python", Custom: &interviews.CustomQuestion{Title: "Increment", StatementMarkdown: "Increment n.", Signature: problems.Signature{ClassName: "Solution", MethodName: "increment", Parameters: []problems.Parameter{{Name: "n", Type: "int"}}, ReturnType: "int"}, StarterSource: "class Solution:\n    def increment(self, n):\n        pass\n", PublicCases: []problems.Case{{Args: []json.RawMessage{json.RawMessage(`1`)}, Expected: json.RawMessage(`2`)}}, PrivateCases: []problems.Case{{Args: []json.RawMessage{json.RawMessage(`2`)}, Expected: json.RawMessage(`3`)}}}}
	pad, err := store.CreateInterview(ctx, "alice", postgres.ID(), interviews.Create{Title: "Concurrent socket", Question: q})
	if err != nil {
		t.Fatal(err)
	}
	api := &Server{Store: store, Local: true, Events: realtime.NewMemory()}
	server := httptest.NewServer(api.Handler())
	defer server.Close()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+"/v1/interviews/"+pad.ID+"/events", &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{"http://localhost:5173"}, "X-Dev-User": []string{"alice"}}})
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	tx, err := store.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT id FROM interviews WHERE id=$1 FOR NO KEY UPDATE", pad.ID); err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(map[string]any{"id": "waiting-write", "type": "push", "key": postgres.ID(), "push": interviews.Push{Epoch: pad.Document.Epoch, Version: pad.Document.Version, Updates: []interviews.Update{{ClientID: "writer", Changes: json.RawMessage(`[0,"# hello\n"]`)}}}})
	if err = c.Write(ctx, websocket.MessageText, data); err != nil {
		t.Fatal(err)
	}
	data, _ = json.Marshal(map[string]any{"id": "independent-read", "type": "snapshot"})
	if err = c.Write(ctx, websocket.MessageText, data); err != nil {
		t.Fatal(err)
	}
	deadline, done := context.WithTimeout(ctx, time.Second)
	defer done()
	for {
		_, data, err = c.Read(deadline)
		if err != nil {
			t.Fatalf("read queued behind document lock: %v", err)
		}
		var frame struct {
			ID    string
			Value interviews.Snapshot
			Error json.RawMessage
		}
		if err = json.Unmarshal(data, &frame); err != nil {
			t.Fatal(err)
		}
		if frame.ID == "independent-read" {
			if len(frame.Error) > 0 || frame.Value.ID != pad.ID {
				t.Fatalf("bad snapshot: %s", data)
			}
			break
		}
	}
}
