package postgres

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"github.com/ethan-ngai/quorem/apps/api/internal/access"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/apps/api/internal/matches"
	"github.com/ethan-ngai/quorem/internal/execution"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func guestCredential() string {
	raw := make([]byte, 32)
	rand.Read(raw)
	return base64.RawURLEncoding.EncodeToString(raw)
}
func grantInternal(t *testing.T, s *Store, owner string) {
	t.Helper()
	if err := s.ApplyGrant(context.Background(), access.Grant{OperationID: ID(), UserID: owner, Actor: "test-operator", Reason: "Fixture", Scope: "internal", Source: "internal", Reference: "test"}, false); err != nil {
		t.Fatal(err)
	}
}
func guestRoom(t *testing.T, s *Store, mode string) matches.Created {
	t.Helper()
	grantInternal(t, s, "alice")
	c, err := s.CreateMatch(context.Background(), "alice", ID(), matches.Settings{Mode: mode, Difficulty: "easy", DurationMinutes: 30, AccessMode: "guests_allowed"})
	if err != nil {
		t.Fatal(err)
	}
	return c
}
func TestGuestEntitlementsAndOperatorAudit(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	settings := matches.Settings{Difficulty: "easy", DurationMinutes: 30, AccessMode: "guests_allowed"}
	s.Pool.Exec(ctx, "UPDATE users SET role='admin' WHERE id='alice'")
	if _, err := s.CreateMatch(ctx, "alice", ID(), settings); errorCode(err) != "entitlement_required" {
		t.Fatalf("admin bypassed entitlement: %v", err)
	}
	if _, err := s.CreateMatch(ctx, "bob", ID(), matches.Settings{Difficulty: "easy", DurationMinutes: 30}); err != nil {
		t.Fatalf("free regular hosting: %v", err)
	}
	g := access.Grant{OperationID: ID(), UserID: "alice", Actor: "operator", Reason: "Pilot", Scope: "internal", Source: "manual", Reference: "operator"}
	if err := s.ApplyGrant(ctx, g, true); err != nil {
		t.Fatal(err)
	}
	c, _ := s.Capabilities(ctx, "alice")
	if c.HostGuests {
		t.Fatal("dry run granted access")
	}
	if err := s.ApplyGrant(ctx, g, false); err != nil {
		t.Fatal(err)
	}
	if err := s.ApplyGrant(ctx, g, false); err != nil {
		t.Fatal(err)
	}
	c, _ = s.Capabilities(ctx, "alice")
	if !c.HostGuests || !c.HostedIntelligence || !c.Experimental {
		t.Fatalf("internal bundle %+v", c)
	}
	g.Scope = "admin"
	if err := s.ApplyGrant(ctx, g, false); errorCode(err) != "idempotency_conflict" {
		t.Fatalf("changed operation replay: %v", err)
	}
	var audit int
	s.Pool.QueryRow(ctx, "SELECT count(*) FROM access_audit").Scan(&audit)
	if audit != 1 {
		t.Fatalf("duplicate audit %d", audit)
	}
	if _, err := s.Pool.Exec(ctx, "DELETE FROM access_audit"); err == nil {
		t.Fatal("audit was mutable")
	}
}

func TestGuestHostingRequiresMatchCapability(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	settings := matches.Settings{Difficulty: "easy", DurationMinutes: 30, AccessMode: "guests_allowed"}
	if _, err := s.CreateMatch(ctx, "bob", ID(), settings); errorCode(err) != "entitlement_required" {
		t.Fatalf("host without capability: %v", err)
	}
	grant := access.Grant{OperationID: ID(), UserID: "alice", Actor: "test", Reason: "Pilot", Scope: "matches.host_guests", Source: "internal", Reference: "guest-match-test"}
	if err := s.ApplyGrant(ctx, grant, false); err != nil {
		t.Fatal(err)
	}
	room, err := s.CreateMatch(ctx, "alice", ID(), settings)
	if err != nil {
		t.Fatalf("host with match capability: %v", err)
	}
	if _, err = s.JoinGuest(ctx, inviteToken(t, room), guestCredential(), "Guest"); err != nil {
		t.Fatalf("guest admission: %v", err)
	}
}
func TestGuestConcurrentJoinsResumeAndRevocation(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	room := guestRoom(t, s, matches.FreeForAll)
	token := inviteToken(t, room)
	credential := guestCredential()
	var wg sync.WaitGroup
	var success atomic.Int32
	for range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := s.JoinGuest(ctx, token, credential, "Guest"); err == nil {
				success.Add(1)
			}
		}()
	}
	wg.Wait()
	if success.Load() != 12 {
		t.Fatalf("retry failures %d", success.Load())
	}
	var count int
	s.Pool.QueryRow(ctx, "SELECT count(*) FROM match_participants WHERE match_id=$1", room.ID).Scan(&count)
	if count != 2 {
		t.Fatalf("duplicate seats %d", count)
	}
	p, err := s.GuestIdentity(ctx, credential)
	if err != nil || !p.Guest || p.EmailVerified {
		t.Fatalf("principal %+v %v", p, err)
	}
	if _, err := s.CreateMatch(ctx, p.UserID, ID(), matches.Settings{Difficulty: "easy", DurationMinutes: 30}); errorCode(err) != "forbidden" {
		t.Fatalf("guest hosted: %v", err)
	}
	other, err := s.CreateMatch(ctx, "bob", ID(), matches.Settings{Difficulty: "easy", DurationMinutes: 30})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.JoinGuest(ctx, inviteToken(t, other), credential, "Guest"); errorCode(err) != "forbidden" {
		t.Fatalf("cross-room credential: %v", err)
	}
	if _, err := s.UpdateMatchSettings(ctx, "alice", room.ID, ID(), matches.Settings{Mode: matches.FreeForAll, Difficulty: "easy", DurationMinutes: 30}); errorCode(err) != "invalid_transition" {
		t.Fatalf("disabled guest room with members: %v", err)
	}
	success.Store(0)
	for range 15 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := s.JoinGuest(ctx, token, guestCredential(), "Guest"); err == nil {
				success.Add(1)
			}
		}()
	}
	wg.Wait()
	if success.Load() != 6 {
		t.Fatalf("seat bound: %d", success.Load())
	}
	if _, err := s.RemoveGuest(ctx, "alice", room.ID, p.UserID, ID()); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GuestIdentity(ctx, credential); err == nil {
		t.Fatal("revoked guest authenticated")
	}
	rotated, err := s.RotateInvite(ctx, "alice", room.ID, ID())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.PreviewInvite(ctx, token); errorCode(err) != "not_found" {
		t.Fatalf("old invitation survived rotation: %v", err)
	}
	if _, err := s.PreviewInvite(ctx, inviteToken(t, rotated)); err != nil {
		t.Fatal(err)
	}
}
func TestGuestExecutionReservationsAndFencedSettlement(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	room := guestRoom(t, s, matches.FreeForAll)
	token := inviteToken(t, room)
	owners := []string{}
	workspaces := []string{}
	for _, name := range []string{"One", "Two"} {
		cookie := guestCredential()
		if _, err := s.JoinGuest(ctx, token, cookie, name); err != nil {
			t.Fatal(err)
		}
		p, err := s.GuestIdentity(ctx, cookie)
		if err != nil {
			t.Fatal(err)
		}
		owners = append(owners, p.UserID)
		if _, err := s.ReadyMatch(ctx, p.UserID, room.ID, ID(), true); err != nil {
			t.Fatal(err)
		}
	}
	s.ReadyMatch(ctx, "alice", room.ID, ID(), true)
	if _, err := s.StartMatch(ctx, "alice", room.ID, ID()); err != nil {
		t.Fatal(err)
	}
	for _, owner := range owners {
		v, err := s.Match(ctx, owner, room.ID)
		if err != nil {
			t.Fatal(err)
		}
		for _, p := range v.Participants {
			if p.UserID == owner {
				workspaces = append(workspaces, p.WorkspaceID)
			}
		}
	}
	cmd := judging.Command{WorkspaceID: workspaces[0], Kind: "run", Source: "pass"}
	first, err := s.Admit(ctx, owners[0], ID(), cmd, "one")
	if err != nil {
		t.Fatal(err)
	}
	cmd.WorkspaceID = workspaces[1]
	second, err := s.Admit(ctx, owners[1], ID(), cmd, "two")
	if err != nil {
		t.Fatal("guest admission", err)
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, admissionErr := guestAdmission(ctx, tx, owners[0], room.ID)
	tx.Rollback(ctx)
	if errorCode(admissionErr) != "rate_limited" {
		t.Fatal("sponsor concurrency protection lost", admissionErr)
	}
	if _, err := s.CancelWithKey(ctx, owners[0], first.ID, ID()); err != nil {
		t.Fatal(err)
	}
	job, err := s.Claim(ctx)
	if err != nil || job.SubmissionID != second.ID {
		t.Fatalf("claim %+v %v", job, err)
	}
	if err := s.Complete(ctx, job, execution.Completion{SubmissionID: job.SubmissionID, AttemptID: job.AttemptID, EngineFailure: "transient infrastructure fault"}); err != nil {
		t.Fatal(err)
	}
	var reserved bool
	if err := s.Pool.QueryRow(ctx, "SELECT settled_at IS NULL AND charged_seconds IS NULL FROM guest_execution_usage WHERE submission_id=$1", second.ID).Scan(&reserved); err != nil || !reserved {
		t.Fatal("retry lost reservation", err)
	}
	if err := s.Complete(ctx, job, execution.Completion{SubmissionID: job.SubmissionID, AttemptID: job.AttemptID, Verdict: execution.Accepted}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Pool.Exec(ctx, "UPDATE execution_jobs SET available_at=clock_timestamp()-interval '1 second' WHERE submission_id=$1", second.ID); err != nil {
		t.Fatal(err)
	}
	job, err = s.Claim(ctx)
	if err != nil {
		t.Fatal(err)
	}
	completion := execution.Completion{SubmissionID: job.SubmissionID, AttemptID: job.AttemptID, Verdict: execution.Accepted}
	if err := s.Complete(ctx, job, completion); err != nil {
		t.Fatal(err)
	}
	if err := s.Complete(ctx, job, completion); err != nil {
		t.Fatal(err)
	}
	var settled, attempts int
	var charged int
	s.Pool.QueryRow(ctx, "SELECT count(*),sum(charged_seconds) FROM guest_execution_usage WHERE settled_at IS NOT NULL").Scan(&settled, &charged)
	s.Pool.QueryRow(ctx, "SELECT count(*) FROM execution_attempt_usage WHERE submission_id=$1", second.ID).Scan(&attempts)
	if settled != 2 || attempts != 2 || charged > 60 {
		t.Fatalf("settlement duplicated: %d/%d/%d", settled, attempts, charged)
	}
	if _, err = s.Pool.Exec(ctx, "UPDATE submissions SET admitted_at=clock_timestamp()-interval '8 days'; UPDATE guest_sessions SET expires_at=clock_timestamp()-interval '8 days'"); err != nil {
		t.Fatal(err)
	}
	if err = s.Cleanup(ctx); err != nil {
		t.Fatal(err)
	}
	var retained int
	if err = s.Pool.QueryRow(ctx, "SELECT count(*) FROM submissions WHERE source='' AND result IS NULL AND cases='[]'::jsonb").Scan(&retained); err != nil || retained != 2 {
		t.Fatal("guest retention", retained, err)
	}
	if err = s.Pool.QueryRow(ctx, "SELECT count(*) FROM guest_execution_usage WHERE settled_at IS NOT NULL").Scan(&retained); err != nil || retained != 2 {
		t.Fatal("retention lost accounting", retained, err)
	}
}

func TestGuestGrantSourcesExpiryAndQuota(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	grant := access.Grant{OperationID: ID(), UserID: "alice", Actor: "operator", Reason: "Test", Scope: "matches.host_guests", Source: "internal", Reference: "manual"}
	if err := s.ApplyGrant(ctx, grant, false); err != nil {
		t.Fatal(err)
	}
	grant.OperationID = ID()
	grant.Source = "subscription"
	grant.Reference = "billing"
	if err := s.ApplyGrant(ctx, grant, false); err != nil {
		t.Fatal(err)
	}
	grant.OperationID = ID()
	grant.Revoke = true
	if err := s.ApplyGrant(ctx, grant, false); err != nil {
		t.Fatal(err)
	}
	c, err := s.Capabilities(ctx, "alice")
	if err != nil || !c.HostGuests {
		t.Fatal("subscription revoked independent internal grant", c, err)
	}
	expired := time.Now().Add(-time.Hour)
	grant.OperationID = ID()
	grant.Source = "internal"
	grant.Reference = "manual"
	grant.Revoke = false
	grant.ExpiresAt = &expired
	if err := s.ApplyGrant(ctx, grant, false); err != nil {
		t.Fatal(err)
	}
	c, err = s.Capabilities(ctx, "alice")
	if err != nil || c.HostGuests {
		t.Fatal("expired grant", c, err)
	}
	if err = s.ApplyQuota(ctx, "alice", "guest_concurrency", "operator", "Pilot", ID(), 9, false); errorCode(err) != "invalid_input" {
		t.Fatal("platform ceiling", err)
	}
	op := ID()
	if err = s.ApplyQuota(ctx, "alice", "guest_concurrency", "operator", "Pilot", op, 3, false); err != nil {
		t.Fatal(err)
	}
	if err = s.ApplyQuota(ctx, "alice", "guest_concurrency", "operator", "Pilot", op, 3, false); err != nil {
		t.Fatal(err)
	}
	if err = s.ApplyQuota(ctx, "bob", "guest_concurrency", "operator", "Pilot", op, 3, false); errorCode(err) != "idempotency_conflict" {
		t.Fatal("cross-target quota replay", err)
	}
}

func TestGuestPublicRequestLimits(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	if ok, err := s.GuestRequestAllowed(ctx, "127.0.0.1"); err != nil || !ok {
		t.Fatal("first request", ok, err)
	}
	if _, err := s.Pool.Exec(ctx, "UPDATE guest_request_buckets SET used=1200 WHERE key LIKE 'peer:%'"); err != nil {
		t.Fatal(err)
	}
	if ok, err := s.GuestRequestAllowed(ctx, "127.0.0.1"); err != nil || ok {
		t.Fatal("peer limit", ok, err)
	}
	if ok, err := s.GuestRequestAllowed(ctx, "127.0.0.2"); err != nil || !ok {
		t.Fatal("different peer", ok, err)
	}
	if _, err := s.Pool.Exec(ctx, "UPDATE guest_request_buckets SET used=6000 WHERE key='global'"); err != nil {
		t.Fatal(err)
	}
	if ok, err := s.GuestRequestAllowed(ctx, "127.0.0.3"); err != nil || ok {
		t.Fatal("global limit", ok, err)
	}
}
