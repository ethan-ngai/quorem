package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/postgres"
	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
)

func TestInterviewHubMembershipSocket(t *testing.T) {
	store := streamStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if _, err := store.Pool.Exec(ctx, `INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES(gen_random_uuid(),'alice','interviews.host','manual','hub','test','test')`); err != nil {
		t.Fatal(err)
	}
	problem, err := store.Problem(ctx, "run-widths", false)
	if err != nil {
		t.Fatal(err)
	}
	bus := realtime.NewMemory()
	defer bus.Close()
	server := httptest.NewServer((&Server{Store: store, Local: true, Events: bus, Origins: []string{"https://quorem.test"}}).Handler())
	defer server.Close()
	connect := func(user string) *websocket.Conn {
		t.Helper()
		conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http")+"/v1/memberships/events?user="+user, &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{"https://quorem.test"}, "X-Dev-User": []string{user}}})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { conn.CloseNow() })
		return conn
	}
	read := func(conn *websocket.Conn) {
		t.Helper()
		_, data, err := conn.Read(ctx)
		if err != nil || string(data) != `{"type":"membership.updated"}` {
			t.Fatalf("membership frame %s: %v", data, err)
		}
	}
	dispatch := func() {
		t.Helper()
		if err := store.DispatchMembershipEvents(ctx, func(n realtime.Notice) error { return bus.Publish(ctx, "/memberships/"+n.AggregateID, n) }); err != nil {
			t.Fatal(err)
		}
	}
	alice, bob := connect("alice"), connect("bob")
	read(alice)
	read(bob)
	room, err := store.CreateInterview(ctx, "alice", postgres.ID(), interviews.Create{Title: "Hub", Question: interviews.QuestionInput{Language: "python", ProblemVersionID: problem.ID}})
	if err != nil {
		t.Fatal(err)
	}
	dispatch()
	read(alice)
	if _, err = store.JoinInterview(ctx, "bob", strings.TrimPrefix(room.InvitePath, "/interview-invite/"), "", ""); err != nil {
		t.Fatal(err)
	}
	dispatch()
	read(alice)
	read(bob)
	if _, err = store.RemoveInterviewMember(ctx, "alice", room.ID, postgres.ID(), "bob"); err != nil {
		t.Fatal(err)
	}
	dispatch()
	read(alice)
	read(bob)
}
