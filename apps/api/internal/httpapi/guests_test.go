package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/internal/access"
	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/postgres"
	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"github.com/ethan-ngai/quorem/apps/api/internal/matches"
)

func TestGuestHTTPBoundary(t *testing.T) {
	store := streamStore(t)
	ctx := context.Background()
	if err := store.ApplyGrant(ctx, access.Grant{OperationID: postgres.ID(), UserID: "alice", Scope: "internal", Source: "internal", Reference: "fixture", Actor: "operator", Reason: "Test"}, false); err != nil {
		t.Fatal(err)
	}
	room, err := store.CreateMatch(ctx, "alice", postgres.ID(), matches.Settings{Difficulty: "easy", DurationMinutes: 30, AccessMode: "guests_allowed"})
	if err != nil {
		t.Fatal(err)
	}
	token := strings.TrimPrefix(room.InviteURL, "/invite/")
	api := &Server{Store: store, Origins: []string{"http://localhost:5173"}, GuestAdmission: true}
	send := func(method, path, body, origin, bearer string, cookie *http.Cookie) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		if bearer != "" {
			r.Header.Set("Authorization", bearer)
		}
		if cookie != nil {
			r.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		api.Handler().ServeHTTP(w, r)
		return w
	}
	if w := send("POST", "/v1/guest-sessions", "", "", "", nil); w.Code != 403 {
		t.Fatal("missing origin", w.Code)
	}
	if w := send("POST", "/v1/guest-sessions", "", "https://evil.test", "", nil); w.Code != 403 {
		t.Fatal("foreign origin", w.Code)
	}
	w := send("POST", "/v1/guest-sessions", "", "http://localhost:5173", "", nil)
	if w.Code != 204 {
		t.Fatal(w.Code, w.Body.String())
	}
	cookies := w.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode || cookies[0].Secure {
		t.Fatal("unsafe local cookie", cookies)
	}
	cookie := cookies[0]
	path := "/v1/match-invites/" + token + "/guest"
	w = send("POST", path, `{"name":"HTTP guest"}`, "http://localhost:5173", "", cookie)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var snapshot matches.Snapshot
	if err = json.Unmarshal(w.Body.Bytes(), &snapshot); err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Participants) != 2 {
		t.Fatal("join missing", snapshot)
	}
	for _, route := range [][2]string{{"POST", "/v1/matches"}, {"POST", "/v1/workspaces"}, {"GET", "/v1/admin/question-drafts"}, {"GET", "/v1/capabilities"}, {"GET", "/v1/matches/00000000-0000-4000-8000-000000000000"}} {
		if w = send(route[0], route[1], `{}`, "http://localhost:5173", "", cookie); w.Code != 403 {
			t.Fatalf("guest escaped: %v %d %s", route, w.Code, w.Body.String())
		}
	}
	if w = send("GET", "/v1/session", "", "", "Bearer invalid", cookie); w.Code != 401 {
		t.Fatal("invalid account downgraded", w.Code)
	}
	if w = send("POST", "/v1/matches/"+room.ID+"/ready", `{"ready":true}`, "", "", cookie); w.Code != 403 {
		t.Fatal("cookie CSRF", w.Code)
	}
	if w = send("GET", "/v1/session", "", "", "", cookie); w.Code != 200 || !strings.Contains(w.Body.String(), `"kind":"guest"`) {
		t.Fatal("refresh", w.Code, w.Body.String())
	}
	if w = send("POST", "/v1/submissions", `{}`, "http://localhost:5173", "", cookie); w.Code != 503 {
		t.Fatal("execution kill switch", w.Code)
	}
	api.GuestAdmission = false
	if w = send("POST", path, `{"name":"HTTP guest"}`, "http://localhost:5173", "", cookie); w.Code != 503 {
		t.Fatal("admission kill switch", w.Code)
	}
	if w = send("GET", "/v1/matches/"+room.ID, "", "", "", cookie); w.Code != 200 {
		t.Fatal("kill switch hid results", w.Code)
	}
	if _, err = store.Pool.Exec(ctx, "UPDATE guest_sessions SET expires_at=clock_timestamp()-interval '1 second'"); err != nil {
		t.Fatal(err)
	}
	if w = send("GET", "/v1/session", "", "", "", cookie); w.Code != 401 {
		t.Fatal("expired credential", w.Code)
	}
}

func TestPublishingRequiresRecentStrongSession(t *testing.T) {
	s := &Server{}
	mux := http.NewServeMux()
	s.registerAdminQuestions(mux)
	for _, until := range []int64{0, time.Now().Add(-time.Minute).Unix()} {
		r := httptest.NewRequest("POST", "/v1/admin/question-drafts/00000000-0000-4000-8000-000000000001/publish", strings.NewReader(`{"revision":"1","strongUntil":4102444800}`))
		r = r.WithContext(identity.With(r.Context(), identity.Principal{UserID: "admin", Admin: true, EmailVerified: true, StrongUntil: until}))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		if w.Code != 403 || !strings.Contains(w.Body.String(), "step_up_required") {
			t.Fatal("missing step-up", w.Code, w.Body.String())
		}
	}
}
