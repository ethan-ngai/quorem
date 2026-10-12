package httpapi

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLocalIdentityFailsClosedAndCommandsRejectUnknownFields(t *testing.T) {
	tests := []struct {
		name, remote, origin, user, path, body string
		local                                  bool
		want                                   int
	}{{name: "production", remote: "127.0.0.1:1000", path: "/v1/workspaces/00000000-0000-4000-8000-000000000000", local: false, want: 401}, {name: "remote", remote: "192.0.2.1:1000", path: "/health", local: true, want: 401}, {name: "unknown owner", remote: "127.0.0.1:1000", user: "mallory", path: "/health", local: true, want: 401}, {name: "foreign origin", remote: "127.0.0.1:1000", origin: "https://example.com", path: "/health", local: true, want: 403}, {name: "unknown command field", remote: "127.0.0.1:1000", path: "/v1/workspaces", body: `{"problemVersionId":"00000000-0000-0000-0000-000000000000","language":"python","ownerId":"bob"}`, local: true, want: 400}, {name: "removed restore route", remote: "127.0.0.1:1000", path: "/v1/workspaces/00000000-0000-0000-0000-000000000000/restore", body: `{ "revision": "invalid" }`, local: true, want: 404}, {name: "cancel key required", remote: "127.0.0.1:1000", path: "/v1/submissions/00000000-0000-0000-0000-000000000000/cancel", local: true, want: 400}}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			method := "GET"
			if test.body != "" || strings.HasSuffix(test.path, "/cancel") {
				method = "POST"
			}
			request := httptest.NewRequest(method, test.path, strings.NewReader(test.body))
			request.RemoteAddr = test.remote
			request.Header.Set("Origin", test.origin)
			request.Header.Set("X-Dev-User", test.user)
			response := httptest.NewRecorder()
			(&Server{Local: test.local}).Handler().ServeHTTP(response, request)
			if response.Code != test.want {
				t.Fatalf("got %d: %s", response.Code, response.Body.String())
			}
			if test.want != 404 && !strings.Contains(response.Body.String(), "requestId") {
				t.Fatal("missing safe error request ID")
			}
		})
	}
}

func TestEmptyCustomSuiteRejectedAtHTTPBoundary(t *testing.T) {
	request := httptest.NewRequest("POST", "/v1/submissions", strings.NewReader(`{"workspaceId":"00000000-0000-4000-8000-000000000000","kind":"run","source":"pass","customCases":[]}`))
	request.RemoteAddr = "127.0.0.1:1000"
	request.Header.Set("Idempotency-Key", "empty-suite")
	response := httptest.NewRecorder()
	(&Server{Local: true}).Handler().ServeHTTP(response, request)
	if response.Code != 400 {
		t.Fatalf("got %d: %s", response.Code, response.Body.String())
	}
}
