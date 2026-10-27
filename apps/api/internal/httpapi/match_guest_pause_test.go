package httpapi

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPausedGuestHostingRejectsBeforeMatchMutation(t *testing.T) {
	server := &Server{}
	for _, route := range []string{"create", "settings"} {
		t.Run(route, func(t *testing.T) {
			request := httptest.NewRequest("POST", "/", strings.NewReader(`{"accessMode":"guests_allowed"}`))
			request.Header.Set("Idempotency-Key", "key")
			response := httptest.NewRecorder()
			if route == "create" {
				server.createMatch(response, request)
			} else {
				request.SetPathValue("action", "settings")
				server.mutateMatch(response, request)
			}
			if response.Code != 409 || !strings.Contains(response.Body.String(), `"code":"guest_hosting_paused"`) {
				t.Fatalf("response %d: %s", response.Code, response.Body.String())
			}
		})
	}
}
