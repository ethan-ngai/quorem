package postgres

import (
	"context"
	"strings"
	"testing"
)

func TestInterviewDocumentReadAuthorizationAndLifecycle(t *testing.T) {
	s := interviewTestStore(t)
	ctx := context.Background()
	room := createInterviewTest(t, s)
	checkDocument := func(user string) {
		t.Helper()
		doc, err := s.InterviewDocument(ctx, user, room.ID)
		if err != nil || doc != room.Document {
			t.Fatalf("document for %s: %+v %v", user, doc, err)
		}
	}
	checkDenied := func(user, id, code string) {
		t.Helper()
		if _, err := s.InterviewDocument(ctx, user, id); errorCode(err) != code {
			t.Fatalf("%s %s: %v", user, code, err)
		}
	}
	checkDocument("alice")
	checkDenied("alice", "not-a-uuid", "not_found")
	checkDenied("bob", room.ID, "not_found")
	if _, err := s.JoinInterview(ctx, "bob", strings.TrimPrefix(room.InvitePath, "/interview-invite/"), "", ""); err != nil {
		t.Fatal(err)
	}
	checkDocument("bob")
	if _, err := s.Pool.Exec(ctx, `UPDATE users SET disabled=true WHERE id='bob'`); err != nil {
		t.Fatal(err)
	}
	checkDenied("bob", room.ID, "not_found")
	if _, err := s.Pool.Exec(ctx, `UPDATE users SET disabled=false WHERE id='bob'; UPDATE users SET disabled=true WHERE id='alice'`); err != nil {
		t.Fatal(err)
	}
	checkDenied("bob", room.ID, "forbidden")
	checkDenied("alice", room.ID, "not_found")
	if _, err := s.Pool.Exec(ctx, `UPDATE users SET disabled=false WHERE id='alice'; UPDATE entitlement_grants SET revoked_at=clock_timestamp() WHERE user_id='alice'`); err != nil {
		t.Fatal(err)
	}
	checkDocument("bob")
	if _, err := s.CloseInterview(ctx, "alice", room.ID, ID()); err != nil {
		t.Fatal(err)
	}
	checkDocument("bob")
	if _, err := s.Pool.Exec(ctx, `UPDATE interviews SET question='{}' WHERE id=$1`, room.ID); err != nil {
		t.Fatal(err)
	}
	checkDocument("bob")
	if err := s.DeleteInterview(ctx, "alice", room.ID); err != nil {
		t.Fatal(err)
	}
	checkDenied("bob", room.ID, "not_found")
}
