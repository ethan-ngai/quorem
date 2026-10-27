package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
)

type membershipRepository struct{ Repository }

func (membershipRepository) MembershipRealtimeID(_ context.Context, owner string) (string, error) {
	if owner != "stable" {
		panic("unverified owner")
	}
	return "00000000-0000-4000-8000-000000000001", nil
}
func (membershipRepository) MembershipEventNotifications(context.Context) (<-chan struct{}, func(), error) {
	return nil, func() {}, nil
}
func (membershipRepository) DispatchMembershipEvents(context.Context, func(realtime.Notice) error) error {
	return nil
}

func TestMembershipSocketRequiresIdentityAndSignalsChanges(t *testing.T) {
	hub := realtime.NewMemory()
	defer hub.Close()
	server := httptest.NewServer((&Server{Store: membershipRepository{}, Identity: mockIdentity{}, Events: hub, Origins: []string{"https://quorem.test"}}).Handler())
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	url := "ws" + strings.TrimPrefix(server.URL, "http") + "/v1/memberships/events"
	_, response, err := websocket.Dial(ctx, url, &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{"https://quorem.test"}}})
	if err == nil || response == nil || response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous access: %v %v", response, err)
	}
	conn, _, err := websocket.Dial(ctx, url, &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{"https://quorem.test"}}, Subprotocols: []string{"quorem", "bearer.signed"}})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	_, data, err := conn.Read(ctx)
	if err != nil || string(data) != `{"type":"membership.updated"}` {
		t.Fatalf("initial: %s %v", data, err)
	}
	if err = hub.Publish(ctx, "/memberships/00000000-0000-4000-8000-000000000001", realtime.Notice{}); err != nil {
		t.Fatal(err)
	}
	_, data, err = conn.Read(ctx)
	if err != nil || string(data) != `{"type":"membership.updated"}` {
		t.Fatalf("change: %s %v", data, err)
	}
}
