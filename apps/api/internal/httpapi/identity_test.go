package httpapi

import (
	"context"
	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"net/http"
	"net/http/httptest"
	"testing"
)

type mockIdentity struct{ admin bool }

func (m mockIdentity) Verify(context.Context, string) (identity.Principal, error) {
	return identity.Principal{UserID: "stable", EmailVerified: true, Admin: m.admin}, nil
}
func TestManagedIdentityAndAdmin(t *testing.T) {
	for _, admin := range []bool{false, true} {
		s := &Server{Identity: mockIdentity{admin: admin}}
		r := httptest.NewRequest("GET", "/v1/session", nil)
		r.Header.Set("Authorization", "Bearer application-jwt")
		r.Header.Set("X-Quorem-Owner", "attacker")
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		if w.Code != 200 {
			t.Fatal(w.Code)
		}
		r = r.WithContext(identity.With(r.Context(), identity.Principal{UserID: "stable", Admin: admin}))
		w = httptest.NewRecorder()
		if s.RequireAdmin(w, r) != admin {
			t.Fatal("wrong admin gate")
		}
		if !admin && w.Code != http.StatusForbidden {
			t.Fatal(w.Code)
		}
	}
	r := httptest.NewRequest("GET", "/v1/session", nil)
	r.Header.Set("X-Dev-User", "alice")
	w := httptest.NewRecorder()
	(&Server{}).Handler().ServeHTTP(w, r)
	if w.Code != 401 {
		t.Fatal("accepted fixture production", w.Code)
	}
}

func TestPresentCredentialsCannotFallback(t *testing.T) {
	for _, local := range []bool{false, true} {
		for _, header := range []struct{ name, value string }{{"Authorization", ""}, {"Authorization", "Bearer "}, {"Authorization", "Basic token"}, {"Authorization", "Bearer forged"}, {"Sec-WebSocket-Protocol", "quorem, bearer."}, {"Sec-WebSocket-Protocol", "quorem, bearer.forged"}} {
			r := httptest.NewRequest("GET", "/health", nil)
			r.RemoteAddr = "127.0.0.1:8000"
			r.Header.Set(header.name, header.value)
			w := httptest.NewRecorder()
			(&Server{Local: local}).Handler().ServeHTTP(w, r)
			if w.Code != 401 {
				t.Fatalf("local=%t %s=%q accepted %d", local, header.name, header.value, w.Code)
			}
		}
	}
}
