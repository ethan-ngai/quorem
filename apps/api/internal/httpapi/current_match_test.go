package httpapi

import (
	"context"
	"github.com/ethan-ngai/quorem/apps/api/internal/matches"
	"net/http/httptest"
	"testing"
)

type currentMatchRepository struct {
	Repository
	owner string
}

func (r *currentMatchRepository) ActiveMatch(_ context.Context, owner string) (*matches.Snapshot, error) {
	r.owner = owner
	return nil, nil
}

func TestCurrentMatchRequiresIdentityAndIgnoresSuppliedOwner(t *testing.T) {
	r := &currentMatchRepository{}
	handler := (&Server{Store: r, Identity: mockIdentity{}}).Handler()
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/v1/matches/current", nil))
	if w.Code != 401 || r.owner != "" {
		t.Fatalf("anonymous lookup: %d %q", w.Code, r.owner)
	}
	request := httptest.NewRequest("GET", "/v1/matches/current", nil)
	request.Header.Set("Authorization", "Bearer application-jwt")
	request.Header.Set("X-Quorem-Owner", "attacker")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, request)
	if w.Code != 200 || r.owner != "stable" || w.Body.String() != "null\n" || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("current membership: %d %q %s", w.Code, r.owner, w.Body.String())
	}
}
