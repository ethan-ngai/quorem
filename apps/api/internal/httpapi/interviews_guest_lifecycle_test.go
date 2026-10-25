package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/access"
	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/postgres"
	"github.com/ethan-ngai/quorem/apps/api/internal/httpapi"
	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
)

func guestLifecycleStore(t *testing.T) *postgres.Store {
	t.Helper()
	database := os.Getenv("QUOREM_TEST_DATABASE_URL")
	if database == "" {
		t.Skip("QUOREM_TEST_DATABASE_URL enables disposable PostgreSQL integration")
	}
	ctx := context.Background()
	admin, err := postgres.Open(ctx, database)
	if err != nil {
		t.Fatal(err)
	}
	schema := "guest_http_" + strings.ReplaceAll(postgres.ID(), "-", "")
	if _, err = admin.Pool.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		admin.Pool.Close()
		t.Fatal(err)
	}
	target, err := url.Parse(database)
	if err != nil {
		t.Fatal(err)
	}
	params := target.Query()
	params.Set("search_path", schema)
	target.RawQuery = params.Encode()
	s, err := postgres.Open(ctx, target.String())
	if err != nil {
		t.Fatal(err)
	}
	// HTTP tests own a schema so the adapter suite can truncate its disposable schema concurrently.
	t.Cleanup(func() {
		s.Pool.Close()
		if _, err := admin.Pool.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Error(err)
		}
		admin.Pool.Close()
	})
	if err = s.Migrate(ctx, "../../migrations"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `TRUNCATE interviews CASCADE; DELETE FROM entitlement_grants WHERE user_id='alice' AND source_ref='guest-http-lifecycle'`); err != nil {
		t.Fatal(err)
	}
	if err = s.ApplyGrant(ctx, access.Grant{OperationID: postgres.ID(), UserID: "alice", Actor: "test", Reason: "Guest lifecycle fixture", Scope: "interviews.host", Source: "manual", Reference: "guest-http-lifecycle"}, false); err != nil {
		t.Fatal(err)
	}
	if err = s.ApplyQuota(ctx, "alice", "interview_concurrency", "test", "Concurrent guest credential fixtures", postgres.ID(), 2, false); err != nil {
		t.Fatal(err)
	}
	return s
}
func guestLifecycleRoom(t *testing.T, s *postgres.Store) interviews.Snapshot {
	t.Helper()
	v, err := s.CreateInterview(context.Background(), "alice", postgres.ID(), interviews.Create{Title: "Guest lifecycle", Question: interviews.QuestionInput{Language: "python", Custom: &interviews.CustomQuestion{Title: "Increment", StatementMarkdown: "Add one.", Signature: problems.Signature{ClassName: "Solution", MethodName: "increment", Parameters: []problems.Parameter{{Name: "n", Type: "int"}}, ReturnType: "int"}, StarterSource: "class Solution:\n    def increment(self,n): return n+1\n", PublicCases: []problems.Case{{Args: []json.RawMessage{json.RawMessage(`1`)}, Expected: json.RawMessage(`2`)}}}}})
	if err != nil {
		t.Fatal(err)
	}
	return v
}
func joinGuestHTTP(t *testing.T, handler http.Handler, room interviews.Snapshot, cookie *http.Cookie, name string) (*httptest.ResponseRecorder, interviews.Snapshot, *http.Cookie) {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"name": name})
	invite, e := url.Parse(room.InvitePath)
	if e != nil {
		t.Fatal(e)
	}
	token := strings.TrimPrefix(invite.Path, "/interview-invite/")
	target := "/v1/interview-invites/" + token + "/join"
	if invite.RawQuery != "" {
		target += "?" + invite.RawQuery
	}
	r := httptest.NewRequest("POST", target, strings.NewReader(string(body)))
	r.Header.Set("Origin", "https://quorem.test")
	r.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	var snapshot interviews.Snapshot
	if w.Code == 200 {
		if err := json.Unmarshal(w.Body.Bytes(), &snapshot); err != nil {
			t.Fatal(err)
		}
	}
	var next *http.Cookie
	for _, c := range w.Result().Cookies() {
		if c.Name == "quorem_interview_guest" {
			next = c
		}
	}
	return w, snapshot, next
}
func TestGuestInterviewHTTPSequentialRoomsRotateCredentials(t *testing.T) {
	s := guestLifecycleStore(t)
	ctx := context.Background()
	first, second := guestLifecycleRoom(t, s), guestLifecycleRoom(t, s)
	handler := (&httpapi.Server{Store: s, Origins: []string{"https://quorem.test"}}).Handler()
	w, joined, cookie := joinGuestHTTP(t, handler, first, nil, "Candidate")
	if w.Code != 200 || cookie == nil {
		t.Fatalf("initial join %d %s", w.Code, w.Body.String())
	}
	if !cookie.HttpOnly || !cookie.Secure {
		t.Fatal("guest cookie flags")
	}
	principal, err := s.InterviewGuestIdentity(ctx, cookie.Value)
	if err != nil {
		t.Fatal(err)
	}
	w, resumed, same := joinGuestHTTP(t, handler, first, cookie, "")
	if w.Code != 200 || same == nil || same.Value != cookie.Value || resumed.ID != joined.ID {
		t.Fatalf("same-room resume %d %s", w.Code, w.Body.String())
	}
	var guestID string
	for _, m := range resumed.Members {
		if m.Guest {
			guestID = m.UserID
		}
	}
	if guestID != principal.UserID {
		t.Fatal("same-room resume duplicated guest")
	}
	w, _, _ = joinGuestHTTP(t, handler, second, cookie, "Candidate")
	if w.Code != 403 {
		t.Fatalf("active-room isolation %d %s", w.Code, w.Body.String())
	}
	if _, err = s.CloseInterview(ctx, "alice", first.ID, postgres.ID()); err != nil {
		t.Fatal(err)
	}
	w, next, rotated := joinGuestHTTP(t, handler, second, cookie, "Candidate")
	if w.Code != 200 || rotated == nil || rotated.Value == cookie.Value || next.ID != second.ID {
		t.Fatalf("closed-room rollover %d %s", w.Code, w.Body.String())
	}
	newPrincipal, err := s.InterviewGuestIdentity(ctx, rotated.Value)
	if err != nil || newPrincipal.UserID == principal.UserID {
		t.Fatal("credential reused across scopes", err)
	}
	if _, err = s.Interview(ctx, newPrincipal.UserID, first.ID); err == nil {
		t.Fatal("new credential retained old scope")
	}
	if _, err = s.Interview(ctx, principal.UserID, second.ID); err == nil {
		t.Fatal("old credential gained new scope")
	}
}
func TestGuestInterviewHTTPExpiredAndRevokedCredentialsCanJoinNextRoom(t *testing.T) {
	for _, state := range []string{"expired", "revoked"} {
		t.Run(state, func(t *testing.T) {
			s := guestLifecycleStore(t)
			ctx := context.Background()
			first, second := guestLifecycleRoom(t, s), guestLifecycleRoom(t, s)
			handler := (&httpapi.Server{Store: s, Origins: []string{"https://quorem.test"}}).Handler()
			w, _, cookie := joinGuestHTTP(t, handler, first, nil, "Candidate")
			if w.Code != 200 || cookie == nil {
				t.Fatalf("initial join %d %s", w.Code, w.Body.String())
			}
			query := `UPDATE interview_guest_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1`
			if state == "revoked" {
				query = `UPDATE interview_guest_sessions SET revoked_at=clock_timestamp() WHERE token_hash=$1`
			}
			if _, err := s.Pool.Exec(ctx, query, postgres.Hash([]byte(cookie.Value))); err != nil {
				t.Fatal(err)
			}
			if state == "revoked" {
				w, _, _ = joinGuestHTTP(t, handler, first, cookie, "Candidate")
				if w.Code != 401 {
					t.Fatalf("same-room revocation bypass %d %s", w.Code, w.Body.String())
				}
			}
			w, next, rotated := joinGuestHTTP(t, handler, second, cookie, "Candidate")
			if w.Code != 200 || rotated == nil || rotated.Value == cookie.Value || next.ID != second.ID {
				t.Fatalf("%s rollover %d %s", state, w.Code, w.Body.String())
			}
		})
	}
}
func TestGuestInterviewHTTPExpiredCredentialCanRejoinSameRoom(t *testing.T) {
	s := guestLifecycleStore(t)
	ctx := context.Background()
	room := guestLifecycleRoom(t, s)
	handler := (&httpapi.Server{Store: s, Origins: []string{"https://quorem.test"}}).Handler()
	w, _, cookie := joinGuestHTTP(t, handler, room, nil, "Candidate")
	if w.Code != 200 || cookie == nil {
		t.Fatalf("initial join %d %s", w.Code, w.Body.String())
	}
	if _, err := s.Pool.Exec(ctx, `UPDATE interview_guest_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1`, postgres.Hash([]byte(cookie.Value))); err != nil {
		t.Fatal(err)
	}
	w, _, rotated := joinGuestHTTP(t, handler, room, cookie, "Candidate")
	if w.Code != 200 || rotated == nil || rotated.Value == cookie.Value {
		t.Fatalf("expired same-room join %d %s", w.Code, w.Body.String())
	}
}

func TestInterviewGuestRoleComesFromInviteTokenNotQuery(t *testing.T) {
	s := guestLifecycleStore(t)
	room := guestLifecycleRoom(t, s)
	handler := (&httpapi.Server{Store: s, Origins: []string{"https://quorem.test"}}).Handler()
	candidateInvite := room
	candidateInvite.InvitePath = room.Invites.Interviewee + "?role=interviewer"
	w, candidate, cookie := joinGuestHTTP(t, handler, candidateInvite, nil, "Candidate")
	if w.Code != 200 || candidate.Role != "interviewee" || candidate.Invites != nil {
		t.Fatalf("query escalated role: %d %s", w.Code, w.Body.String())
	}
	staffInvite := room
	staffInvite.InvitePath = room.Invites.Interviewer
	w, staff, _ := joinGuestHTTP(t, handler, staffInvite, cookie, "")
	if w.Code != 200 || staff.Role != "interviewer" || staff.Invites == nil {
		t.Fatalf("interviewer token admission: %d %s", w.Code, w.Body.String())
	}
}
