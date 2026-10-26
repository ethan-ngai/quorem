package delivery

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDispatchDurableAcceptanceRedirectAndBounds(t *testing.T) {
	token := strings.Repeat("x", 32)
	for _, status := range []int{200, 202, 204, 302, 503} {
		upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "Bearer "+token {
				t.Error("missing control credential")
			}
			var notification Notification
			if json.NewDecoder(r.Body).Decode(&notification) != nil || notification.JobID != "wake-nonce" {
				t.Error("invalid bounded wake")
			}
			if status == 302 {
				w.Header().Set("Location", "https://must-not-follow.invalid")
			}
			w.WriteHeader(status)
		}))
		publisher, err := NewDispatch(DispatchConfig{URL: upstream.URL, Token: token, Client: upstream.Client()})
		if err != nil {
			t.Fatal(err)
		}
		err = publisher.Publish(context.Background(), Notification{JobID: "wake-nonce"})
		if (status == 200 || status == 202 || status == 204) != (err == nil) {
			t.Fatalf("status=%d error=%v", status, err)
		}
		upstream.Close()
	}
	for _, url := range []string{"http://localhost/internal/judge/wake", "https://user:pass@example.test/wake", "https://example.test/wake?secret=1"} {
		if _, err := NewDispatch(DispatchConfig{URL: url, Token: token}); err == nil {
			t.Fatal("accepted unsafe dispatch URL")
		}
	}
}
