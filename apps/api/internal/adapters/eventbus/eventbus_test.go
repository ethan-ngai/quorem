package eventbus

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/coder/websocket"
	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
)

const testChannel = "/matches/00000000-0000-4000-8000-000000000001"

func notice() realtime.Notice {
	return realtime.Notice{ID: "event-id", AggregateID: strings.TrimPrefix(testChannel, "/matches/"), Version: "2", Type: "match.updated", OccurredAt: time.Now().UTC()}
}

func TestAppSyncPublish(t *testing.T) {
	for _, channel := range []string{testChannel, strings.Replace(testChannel, "/matches/", "/interviews/", 1), strings.Replace(testChannel, "/matches/", "/memberships/", 1)} {
		t.Run(channel, func(t *testing.T) { testAppSyncPublish(t, channel) })
	}
}
func testAppSyncPublish(t *testing.T, channel string) {
	n := notice()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != "private-key" || r.Method != "POST" {
			t.Error("missing server authorization")
		}
		var body struct {
			Channel string   `json:"channel"`
			Events  []string `json:"events"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil || body.Channel != channel || len(body.Events) != 1 {
			t.Error("invalid publish envelope")
		}
		var got realtime.Notice
		if json.Unmarshal([]byte(body.Events[0]), &got) != nil || got.ID != n.ID {
			t.Error("notice lost")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"successful":[{"index":0}],"failed":[]}`))
	}))
	defer server.Close()
	a := &AppSync{HTTPURL: server.URL, APIKey: "private-key"}
	if err := a.Publish(context.Background(), channel, n); err != nil {
		t.Fatal(err)
	}
}
func TestAppSyncPartialFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"successful":[],"failed":[{"index":0}]}`))
	}))
	defer server.Close()
	if (&AppSync{HTTPURL: server.URL, APIKey: "key"}).Publish(context.Background(), testChannel, notice()) == nil {
		t.Fatal("partial failure acknowledged")
	}
}
func TestAppSyncIAM(t *testing.T) {
	a := &AppSync{HTTPURL: "https://example.appsync-api.us-east-1.amazonaws.com/event", Region: "us-east-1", Credentials: credentials.NewStaticCredentialsProvider("access", "secret", "session")}
	h, err := a.authorize(context.Background(), []byte("{}"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(h["authorization"], "/us-east-1/appsync/aws4_request") || h["x-amz-security-token"] != "session" || h["host"] == "" {
		t.Fatal("invalid IAM signature")
	}
}
func TestAppSyncSubscription(t *testing.T) {
	for _, channel := range []string{testChannel, strings.Replace(testChannel, "/matches/", "/interviews/", 1), strings.Replace(testChannel, "/matches/", "/memberships/", 1)} {
		t.Run(channel, func(t *testing.T) { testAppSyncSubscription(t, channel) })
	}
}
func testAppSyncSubscription(t *testing.T, channel string) {
	n := notice()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		protocols := strings.Split(r.Header.Get("Sec-WebSocket-Protocol"), ",")
		found := false
		for _, p := range protocols {
			p = strings.TrimSpace(p)
			if strings.HasPrefix(p, "header-") {
				body, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(p, "header-"))
				if err == nil && strings.Contains(string(body), "private-key") {
					found = true
				}
			}
		}
		if !found {
			t.Error("missing handshake authorization")
		}
		c, err := websocket.Accept(w, r, &websocket.AcceptOptions{Subprotocols: []string{"aws-appsync-event-ws"}})
		if err != nil {
			return
		}
		defer c.CloseNow()
		ctx := r.Context()
		_, _, _ = c.Read(ctx)
		_ = writeJSON(ctx, c, map[string]any{"type": "connection_ack", "connectionTimeoutMs": 300000})
		_, body, err := c.Read(ctx)
		if err != nil {
			return
		}
		var sub struct {
			Type, Channel string
			Authorization map[string]string
		}
		if json.Unmarshal(body, &sub) != nil || sub.Type != "subscribe" || sub.Channel != channel || sub.Authorization["x-api-key"] != "private-key" {
			t.Error("invalid subscription")
		}
		_ = writeJSON(ctx, c, map[string]string{"type": "subscribe_success", "id": "quorem"})
		encoded, _ := json.Marshal(n)
		_ = writeJSON(ctx, c, map[string]any{"type": "data", "id": "quorem", "event": []string{string(encoded)}})
		_, _, _ = c.Read(ctx)
	}))
	defer server.Close()
	a := &AppSync{HTTPURL: server.URL, WebSocketURL: strings.Replace(server.URL, "http", "ws", 1), APIKey: "private-key"}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	stream, stop, err := a.Subscribe(ctx, channel)
	if err != nil {
		t.Fatal(err)
	}
	defer stop()
	select {
	case got := <-stream:
		if got.ID != n.ID {
			t.Fatal("wrong notice")
		}
	case <-ctx.Done():
		t.Fatal("notice not received")
	}
}
func TestRedirectsNeverReceiveCredentials(t *testing.T) {
	reached := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reached = true }))
	defer target.Close()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer origin.Close()
	adapters := []realtime.PubSub{&AppSync{HTTPURL: origin.URL, WebSocketURL: strings.Replace(origin.URL, "http", "ws", 1), APIKey: "private-key"}, &Cloudflare{URL: origin.URL, Token: strings.Repeat("x", 32)}}
	for _, adapter := range adapters {
		if adapter.Publish(context.Background(), testChannel, notice()) == nil {
			t.Fatal("redirect accepted")
		}
		if _, _, err := adapter.Subscribe(context.Background(), testChannel); err == nil {
			t.Fatal("websocket redirect accepted")
		}
	}
	if reached {
		t.Fatal("credential-bearing redirect followed")
	}
}
func TestProviderConfiguration(t *testing.T) {
	for _, provider := range []string{"unknown", "aws-appsync", "cloudflare-durable-objects"} {
		_, err := FromEnv(context.Background(), func(k string) string {
			if k == "QUOREM_REALTIME_PROVIDER" {
				return provider
			}
			return ""
		})
		if err == nil {
			t.Fatalf("accepted incomplete %s configuration", provider)
		}
	}
	bus, err := FromEnv(context.Background(), func(string) string { return "" })
	if err != nil || bus != nil {
		t.Fatal("local mode loaded cloud adapter")
	}
	for _, raw := range []string{"http://remote.example", "https://user:secret@example.com", "https://example.com/?token=secret"} {
		if _, err := endpoint(raw, false); err == nil {
			t.Fatal("unsafe endpoint accepted")
		}
	}
}

// Opt-in workerd test exercises the actual Durable Object implementation, not a protocol mock.
func TestCloudflareEmulator(t *testing.T) {
	for _, channel := range []string{testChannel, strings.Replace(testChannel, "/matches/", "/interviews/", 1), strings.Replace(testChannel, "/matches/", "/memberships/", 1)} {
		t.Run(channel, func(t *testing.T) { testCloudflareEmulator(t, channel) })
	}
}
func testCloudflareEmulator(t *testing.T, channel string) {
	base := os.Getenv("QUOREM_RELAY_TEST_URL")
	if base == "" {
		t.Skip("requires local Wrangler")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c := &Cloudflare{URL: base, Token: os.Getenv("QUOREM_RELAY_TEST_TOKEN")}
	stream, stop, err := c.Subscribe(ctx, channel)
	if err != nil {
		t.Fatal(err)
	}
	defer stop()
	n := notice()
	if err = c.Publish(ctx, channel, n); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-stream:
		if got.ID != n.ID {
			t.Fatal("wrong notice")
		}
	case <-ctx.Done():
		t.Fatal("relay timed out")
	}
	wrong := *c
	wrong.Token = strings.Repeat("z", 32)
	if wrong.Publish(ctx, channel, n) == nil {
		t.Fatal("unauthorized publish accepted")
	}
	n.AggregateID = "other"
	if c.Publish(ctx, channel, n) == nil {
		t.Fatal("cross-match notice accepted")
	}
}
