package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
)

type interviewRepositoryFake struct {
	Repository
	InterviewRepository
	readUser   string
	guestValid bool
}

func (r *interviewRepositoryFake) InterviewGuestIdentity(_ context.Context, token string) (identity.Principal, error) {
	if r.guestValid && token == "interview-token" {
		return identity.Principal{UserID: "guest-candidate", Guest: true}, nil
	}
	return identity.Principal{}, identity.ErrUnauthorized
}
func (r *interviewRepositoryFake) Interview(_ context.Context, user, id string) (interviews.Snapshot, error) {
	r.readUser = user
	return interviews.Snapshot{ID: id}, nil
}
func TestInterviewCookieOnlyAuthorizesInterviewRoutes(t *testing.T) {
	const id = "00000000-0000-4000-8000-000000000001"
	for _, tt := range []struct {
		name, path, cookie string
		valid              bool
		want               int
	}{
		{"anonymous", "/v1/interviews/" + id, "", false, 401},
		{"interview cookie", "/v1/interviews/" + id, interviewGuestCookie, true, 200},
		{"revoked interview cookie", "/v1/interviews/" + id, interviewGuestCookie, false, 401},
		{"match cookie not interview credential", "/v1/interviews/" + id, guestCookie, true, 401},
		{"interview cookie not match credential", "/v1/workspaces/" + id, interviewGuestCookie, true, 401},
	} {
		t.Run(tt.name, func(t *testing.T) {
			repo := &interviewRepositoryFake{guestValid: tt.valid}
			r := httptest.NewRequest("GET", tt.path, nil)
			if tt.cookie != "" {
				r.AddCookie(&http.Cookie{Name: tt.cookie, Value: "interview-token"})
			}
			w := httptest.NewRecorder()
			(&Server{Store: repo}).Handler().ServeHTTP(w, r)
			if w.Code != tt.want {
				t.Fatalf("got %d %s", w.Code, w.Body.String())
			}
			if tt.want == 200 && repo.readUser != "guest-candidate" {
				t.Fatal("wrong guest principal")
			}
		})
	}
}
func TestInterviewGuestWritesRequireAllowedOrigin(t *testing.T) {
	repo := &interviewRepositoryFake{guestValid: true}
	r := httptest.NewRequest("POST", "/v1/interviews/00000000-0000-4000-8000-000000000001/updates", strings.NewReader(`{}`))
	r.AddCookie(&http.Cookie{Name: interviewGuestCookie, Value: "interview-token"})
	w := httptest.NewRecorder()
	(&Server{Store: repo}).Handler().ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatalf("got %d %s", w.Code, w.Body.String())
	}
}
