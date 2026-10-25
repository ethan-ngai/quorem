package httpapi

import (
	"context"
	"github.com/ethan-ngai/quorem/apps/api/internal/matches"
	"net/http/httptest"
	"testing"
)

type invitePreviewRepository struct {
	Repository
	token string
	calls int
}

func (r *invitePreviewRepository) PreviewInvite(_ context.Context, token string) (matches.InvitePreview, error) {
	r.token = token
	r.calls++
	return matches.InvitePreview{Mode: "showdown", Difficulties: []string{"easy"}, DurationMinutes: 30, Rules: matches.Rules{Clipboard: "off", Focus: "off"}, ParticipantCount: 1, Capacity: 2}, nil
}
func TestInvitePreviewIsPublicButJoiningStillRequiresIdentity(t *testing.T) {
	r := &invitePreviewRepository{}
	h := (&Server{Store: r}).Handler()
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/v1/match-invites/private-token", nil))
	if w.Code != 200 || r.token != "private-token" || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("preview: %d %s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/v1/matches/join", nil))
	if w.Code != 401 {
		t.Fatalf("join bypass: %d", w.Code)
	}
	request := httptest.NewRequest("GET", "/v1/match-invites/private-token", nil)
	request.Header.Set("Authorization", "Bearer ")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, request)
	if w.Code != 401 || r.calls != 1 {
		t.Fatalf("invalid credential fallback: %d calls=%d", w.Code, r.calls)
	}
}
