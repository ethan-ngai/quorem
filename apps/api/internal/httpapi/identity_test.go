package httpapi

import (
	"context"
	"errors"
	"fmt"
	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"net/http"
	"net/http/httptest"
	"strings"
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

type failedIdentity struct{ err error }

func (v failedIdentity) Verify(context.Context, string) (identity.Principal, error) {
	return identity.Principal{}, v.err
}

func TestIdentityOutagesDoNotInvalidateAccountSessions(t *testing.T) {
	for _, tc := range []struct {
		name   string
		err    error
		status int
	}{
		{"revoked", identity.ErrUnauthorized, http.StatusUnauthorized},
		{"wrapped invalid credentials", fmt.Errorf("revoked: %w", identity.ErrUnauthorized), http.StatusUnauthorized},
		{"auth service unavailable", identity.ErrUnavailable, http.StatusServiceUnavailable},
		{"database failure", errors.New("private dependency details"), http.StatusServiceUnavailable},
		{"deadline", context.DeadlineExceeded, http.StatusServiceUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest("GET", "/v1/session", nil)
			request.Header.Set("Authorization", "Bearer application-jwt")
			response := httptest.NewRecorder()
			(&Server{Identity: failedIdentity{tc.err}}).Handler().ServeHTTP(response, request)
			if response.Code != tc.status {
				t.Fatalf("got %d: %s", response.Code, response.Body.String())
			}
			if strings.Contains(response.Body.String(), "private dependency details") {
				t.Fatal("leaked dependency failure")
			}
			if response.Header().Get("Set-Cookie") != "" {
				t.Fatal("cleared session on verification failure")
			}
		})
	}
}

type failedGuestIdentity struct {
	Repository
	InterviewRepository
	err error
}

func (r failedGuestIdentity) GuestIdentity(context.Context, string) (identity.Principal, error) {
	return identity.Principal{}, r.err
}
func (r failedGuestIdentity) InterviewGuestIdentity(context.Context, string) (identity.Principal, error) {
	return identity.Principal{}, r.err
}

func TestGuestDependencyOutagesPreserveCredentials(t *testing.T) {
	for _, tc := range []struct{ name, path, cookie string }{
		{"interview", "/v1/interviews/00000000-0000-4000-8000-000000000001", interviewGuestCookie},
		{"match", "/v1/session", guestCookie},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest("GET", tc.path, nil)
			request.AddCookie(&http.Cookie{Name: tc.cookie, Value: "valid-credential"})
			response := httptest.NewRecorder()
			(&Server{Store: failedGuestIdentity{err: errors.New("database offline")}}).Handler().ServeHTTP(response, request)
			if response.Code != http.StatusServiceUnavailable {
				t.Fatalf("got %d: %s", response.Code, response.Body.String())
			}
			if response.Header().Get("Set-Cookie") != "" {
				t.Fatal("cleared guest credential on dependency failure")
			}
		})
	}
}
