package postgres

import (
	"context"
	"encoding/base64"
	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"sync"
	"testing"
)

func TestInterviewHostingLimitSerializesReplicasAndAllowsOverride(t *testing.T) {
	s := interviewTestStore(t)
	ctx := context.Background()
	var wg sync.WaitGroup
	results := make(chan error, 4)
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			replica := &Store{Pool: s.Pool, inviteKey: s.inviteKey}
			_, err := replica.CreateInterview(ctx, "alice", ID(), interviews.Create{Title: "Concurrent", Question: customInterviewQuestion()})
			results <- err
		}()
	}
	wg.Wait()
	close(results)
	succeeded, rejected := 0, 0
	for err := range results {
		if err == nil {
			succeeded++
		} else if errorCode(err) == "quota_exceeded" {
			rejected++
		} else {
			t.Fatal(err)
		}
	}
	if succeeded != 1 || rejected != 3 {
		t.Fatalf("success=%d rejected=%d", succeeded, rejected)
	}
	if err := s.ApplyQuota(ctx, "alice", "interview_concurrency", "test", "Pilot", ID(), 2, false); err != nil {
		t.Fatal(err)
	}
	key := ID()
	command := interviews.Create{Title: "Retry", Question: customInterviewQuestion()}
	second, err := s.CreateInterview(ctx, "alice", key, command)
	if err != nil {
		t.Fatal(err)
	}
	retry, err := s.CreateInterview(ctx, "alice", key, command)
	if err != nil || retry.ID != second.ID {
		t.Fatal("capacity retry", err)
	}
	if _, err := s.CreateInterview(ctx, "alice", ID(), interviews.Create{Title: "Third", Question: customInterviewQuestion()}); errorCode(err) != "quota_exceeded" {
		t.Fatal("override limit", err)
	}
	if _, err := s.CloseInterview(ctx, "alice", second.ID, ID()); err != nil {
		t.Fatal(err)
	}
	createInterviewTest(t, s)
}

func TestInterviewDeletionRequiresHostAndClosedSession(t *testing.T) {
	s := interviewTestStore(t)
	ctx := context.Background()
	v := createInterviewTest(t, s)
	if err := s.DeleteInterview(ctx, "alice", v.ID); errorCode(err) != "invalid_transition" {
		t.Fatal("active deletion", err)
	}
	if _, err := s.JoinInterview(ctx, "bob", v.InvitePath[len("/interview-invite/"):], "", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetInterviewMember(ctx, "alice", v.ID, ID(), "bob", "interviewer"); err != nil {
		t.Fatal(err)
	}
	credential := base64.RawURLEncoding.EncodeToString(make([]byte, 32))
	_, err := s.JoinInterview(ctx, "", v.InvitePath[len("/interview-invite/"):], credential, "Guest")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CloseInterview(ctx, "alice", v.ID, ID()); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteInterview(ctx, "bob", v.ID); errorCode(err) != "forbidden" {
		t.Fatal("co-interviewer deletion", err)
	}
	for range 2 {
		if err := s.DeleteInterview(ctx, "alice", v.ID); err != nil {
			t.Fatal("retry", err)
		}
	}
	principal, err := s.InterviewGuestIdentity(ctx, credential)
	if err == nil {
		t.Fatal("deleted guest credential still valid", principal)
	}
	for _, user := range []string{"alice", "bob"} {
		if _, err := s.Interview(ctx, user, v.ID); errorCode(err) != "not_found" {
			t.Fatal("deleted read", err)
		}
		sessions, err := s.Interviews(ctx, user)
		if err != nil || len(sessions) != 0 {
			t.Fatal("deleted list", sessions, err)
		}
	}
	createInterviewTest(t, s)
}

func TestInterviewCanEndAfterHostingRevoked(t *testing.T) {
	s := interviewTestStore(t)
	ctx := context.Background()
	v := createInterviewTest(t, s)
	if _, err := s.Pool.Exec(ctx, `UPDATE entitlement_grants SET revoked_at=clock_timestamp() WHERE user_id='alice'`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CloseInterview(ctx, "alice", v.ID, ID()); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteInterview(ctx, "alice", v.ID); err != nil {
		t.Fatal(err)
	}
}
