package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/postgres"
	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
)

func TestAdminQuestionRoutesRejectForgedRoles(t *testing.T) {
	routes := [][2]string{{"GET", "/v1/admin/question-drafts"}, {"POST", "/v1/admin/question-drafts"}, {"GET", "/v1/admin/question-drafts/00000000-0000-4000-8000-000000000001"}, {"PUT", "/v1/admin/question-drafts/00000000-0000-4000-8000-000000000001"}, {"POST", "/v1/admin/question-drafts/00000000-0000-4000-8000-000000000001/publish"}}
	s := &Server{}
	mux := http.NewServeMux()
	s.registerAdminQuestions(mux)
	for _, principal := range []identity.Principal{{}, {UserID: "alice", EmailVerified: true}} {
		for _, route := range routes {
			r := httptest.NewRequest(route[0], route[1], strings.NewReader(`{"role":"admin"}`))
			r.Header.Set("X-Admin", "true")
			r.Header.Set("X-Quorem-Owner", "admin")
			r = r.WithContext(identity.With(r.Context(), principal))
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, r)
			expected := 403
			if principal.UserID == "" {
				expected = 401
			}
			if w.Code != expected {
				t.Fatalf("%s %s status %d", route[0], route[1], w.Code)
			}
		}
	}
}

func TestAdminQuestionHTTPDraftLifecycle(t *testing.T) {
	ctx := context.Background()
	store := streamStore(t)
	var err error
	// This test creates a unique subject and draft; it never truncates another package's data.
	actor := "admin-http-" + postgres.ID()
	if _, err = store.Pool.Exec(ctx, "INSERT INTO users(id,display_name,role) VALUES($1,'HTTP Admin','admin')", actor); err != nil {
		t.Fatal(err)
	}
	defer func() {
		store.Pool.Exec(ctx, "DELETE FROM question_drafts WHERE created_by=$1", actor)
		store.Pool.Exec(ctx, "DELETE FROM users WHERE id=$1", actor)
	}()
	s := &Server{Store: store}
	mux := http.NewServeMux()
	s.registerAdminQuestions(mux)
	send := func(method, path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r = r.WithContext(identity.With(r.Context(), identity.Principal{UserID: actor, Admin: true, EmailVerified: true, StrongUntil: 4102444800}))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}
	w := send("POST", "/v1/admin/question-drafts", `{"content":{"problem":{},"hiddenCases":[],"attribution":"","implementations":[],"solutions":[]}}`)
	if w.Code != 201 {
		t.Fatal(w.Code, w.Body.String())
	}
	var d postgres.QuestionDraft
	if err = json.Unmarshal(w.Body.Bytes(), &d); err != nil {
		t.Fatal(err)
	}
	w = send("PUT", "/v1/admin/question-drafts/"+d.ID, `{"revision":"1","content":{"problem":{},"hiddenCases":[],"attribution":"mine","implementations":[],"solutions":[]}}`)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	w = send("PUT", "/v1/admin/question-drafts/"+d.ID, `{"revision":"1","content":{"problem":{}}}`)
	if w.Code != 409 {
		t.Fatal("stale revision", w.Code, w.Body.String())
	}
	w = send("POST", "/v1/admin/question-drafts/"+d.ID+"/publish", `{"revision":"2"}`)
	if w.Code != 400 {
		t.Fatal("incomplete publication", w.Code, w.Body.String())
	}
	w = send("GET", "/v1/admin/question-drafts/"+d.ID, "")
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	w = send("POST", "/v1/admin/question-drafts", `{"content":{},"role":"admin"}`)
	if w.Code != 400 {
		t.Fatal("unknown fields accepted", w.Code, w.Body.String())
	}
	w = send("POST", "/v1/admin/question-drafts", `{"content":{},"problemVersionId":"00000000-0000-4000-8000-000000000001"}`)
	if w.Code != 400 {
		t.Fatal("ambiguous creation", w.Code, w.Body.String())
	}
}
