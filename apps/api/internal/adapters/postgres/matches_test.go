package postgres

import (
	"context"
	"encoding/json"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/apps/api/internal/matches"
	"github.com/ethan-ngai/quorem/internal/execution"
)

func TestInvitePreviewSettingsWithoutMembershipOrPrivateData(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	created, err := s.CreateMatch(ctx, "alice", ID(), matches.Settings{Difficulty: "easy", DurationMinutes: 30})
	if err != nil {
		t.Fatal(err)
	}
	token := inviteToken(t, created)
	v, err := s.PreviewInvite(ctx, token)
	if err != nil || v.Mode != "showdown" || v.ParticipantCount != 1 || v.Capacity != 2 || v.DurationMinutes != 30 {
		t.Fatalf("preview: %+v %v", v, err)
	}
	data, _ := json.Marshal(v)
	for _, private := range []string{token, "ownerId", "userId", "displayName", "problemVersionId", "source", "inviteHash"} {
		if strings.Contains(string(data), private) {
			t.Fatalf("preview leaked %s", private)
		}
	}
	var seats int
	if err := s.Pool.QueryRow(ctx, "SELECT count(*) FROM match_participants WHERE match_id=$1", created.ID).Scan(&seats); err != nil || seats != 1 {
		t.Fatalf("preview claimed seat: %d %v", seats, err)
	}
	if _, err := s.PreviewInvite(ctx, "invalid"); errorCode(err) != "not_found" {
		t.Fatalf("invalid token: %v", err)
	}
	if _, err := s.JoinMatch(ctx, "bob", ID(), token); err != nil {
		t.Fatal(err)
	}
	if v, err := s.PreviewInvite(ctx, token); err != nil || v.ParticipantCount != v.Capacity {
		t.Fatalf("full lobby: %+v %v", v, err)
	}
	if _, err := s.Pool.Exec(ctx, "UPDATE matches SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", created.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.PreviewInvite(ctx, token); errorCode(err) != "not_found" {
		t.Fatalf("expired token: %v", err)
	}
}

func TestActiveMatchMembershipAndExpiry(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	if v, err := s.ActiveMatch(ctx, "alice"); err != nil || v != nil {
		t.Fatalf("no reservation: %+v %v", v, err)
	}
	created, err := s.CreateMatch(ctx, "alice", ID(), matches.Settings{Difficulty: "easy", DurationMinutes: 30})
	if err != nil {
		t.Fatal(err)
	}
	if v, err := s.ActiveMatch(ctx, "alice"); err != nil || v == nil || v.ID != created.ID {
		t.Fatalf("host membership: %+v %v", v, err)
	}
	if _, err := s.JoinMatch(ctx, "bob", ID(), inviteToken(t, created)); err != nil {
		t.Fatal(err)
	}
	if v, err := s.ActiveMatch(ctx, "bob"); err != nil || v == nil || v.ID != created.ID {
		t.Fatalf("joined membership: %+v %v", v, err)
	}
	if v, err := s.ActiveMatch(ctx, "charlie"); err != nil || v != nil {
		t.Fatalf("other owner: %+v %v", v, err)
	}
	if _, err := s.LeaveMatch(ctx, "bob", created.ID, ID()); err != nil {
		t.Fatal(err)
	}
	if v, err := s.ActiveMatch(ctx, "bob"); err != nil || v != nil {
		t.Fatalf("departed membership: %+v %v", v, err)
	}
	if _, err := s.Pool.Exec(ctx, "UPDATE matches SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", created.ID); err != nil {
		t.Fatal(err)
	}
	if v, err := s.ActiveMatch(ctx, "alice"); err != nil || v != nil {
		t.Fatalf("expired membership: %+v %v", v, err)
	}
}

func inviteToken(t *testing.T, c matches.Created) string {
	t.Helper()
	u, e := url.Parse(c.InviteURL)
	if e != nil {
		t.Fatal(e)
	}
	if u.IsAbs() || u.Host != "" || !strings.HasPrefix(u.Path, "/invite/") {
		t.Fatal("expected origin-relative invitation path")
	}
	return strings.TrimPrefix(u.Path, "/invite/")
}
func createPair(t *testing.T, s *Store) (string, matches.Snapshot) {
	t.Helper()
	ctx := context.Background()
	c, e := s.CreateMatch(ctx, "alice", ID(), matches.Settings{Difficulty: "easy"})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.JoinMatch(ctx, "bob", ID(), inviteToken(t, c)); e != nil {
		t.Fatal(e)
	}
	v, e := s.ReadyMatch(ctx, "alice", c.ID, ID(), true)
	if e != nil {
		t.Fatal(e)
	}
	if v.ProblemVersionID != "" {
		t.Fatal("problem revealed before start")
	}
	v, e = s.ReadyMatch(ctx, "bob", c.ID, ID(), true)
	if e != nil {
		t.Fatal(e)
	}
	if v.Mode != matches.Showdown || v.State != "active" || v.ProblemVersionID == "" || v.DurationMinutes != 30 {
		t.Fatal(v)
	}
	return c.ID, v
}
func matchWorkspace(t *testing.T, s *Store, id, owner string) string {
	t.Helper()
	v, e := s.Match(context.Background(), owner, id)
	if e != nil {
		t.Fatal(e)
	}
	for _, p := range v.Participants {
		if p.WorkspaceID != "" {
			return p.WorkspaceID
		}
	}
	t.Fatal("missing owner workspace")
	return ""
}
func admitMatch(t *testing.T, s *Store, id, owner, kind string) judging.Submission {
	t.Helper()
	v, e := s.Admit(context.Background(), owner, ID(), judging.Command{WorkspaceID: matchWorkspace(t, s, id, owner), Kind: kind, Source: "private " + owner}, ID())
	if e != nil {
		t.Fatal(e)
	}
	return v
}
func claimJobs(t *testing.T, s *Store, n int) []execution.Job {
	t.Helper()
	jobs := []execution.Job{}
	for range n {
		j, e := claimTestJob(context.Background(), s, false)
		if e != nil || j.JobID == "" {
			t.Fatal(j, e)
		}
		jobs = append(jobs, j)
	}
	return jobs
}
func completeScore(t *testing.T, s *Store, j execution.Job, passed int) {
	t.Helper()
	v := execution.WrongAnswer
	if passed == 20 {
		v = execution.Accepted
	}
	if e := s.Complete(context.Background(), j, execution.Completion{SubmissionID: j.SubmissionID, AttemptID: j.AttemptID, Verdict: v, Score: &execution.Score{Passed: passed, Total: 20}}); e != nil {
		t.Fatal(e)
	}
}
func execSQL(t *testing.T, s *Store, query string, args ...any) {
	t.Helper()
	if _, e := s.Pool.Exec(context.Background(), query, args...); e != nil {
		t.Fatal(e)
	}
}
func TestMatchInviteSeatsReadinessPrivacyAndReservations(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	c, e := s.CreateMatch(ctx, "alice", "create", matches.Settings{Difficulty: "easy"})
	if e != nil {
		t.Fatal(e)
	}
	again, e := s.CreateMatch(ctx, "alice", "create", matches.Settings{Difficulty: "easy"})
	if e != nil || again != c {
		t.Fatal("create replay", again, e)
	}
	if _, e = s.CreateMatch(ctx, "alice", "create", matches.Settings{Difficulty: "hard"}); errorCode(e) != "idempotency_conflict" {
		t.Fatal(e)
	}
	if _, e = s.CreateMatch(ctx, "alice", ID(), matches.Settings{Difficulty: "easy"}); errorCode(e) != "user_busy" {
		t.Fatal(e)
	}
	if _, e = s.Match(ctx, "bob", c.ID); errorCode(e) != "not_found" {
		t.Fatal(e)
	}
	if _, e = s.JoinMatch(ctx, "alice", ID(), inviteToken(t, c)); errorCode(e) != "invalid_transition" {
		t.Fatal(e)
	}
	execSQL(t, s, "INSERT INTO users(id,display_name) VALUES('charlie','Charlie') ON CONFLICT DO NOTHING")
	var wg sync.WaitGroup
	var mu sync.Mutex
	wins := []string{}
	for _, owner := range []string{"bob", "charlie"} {
		wg.Add(1)
		go func(o string) {
			defer wg.Done()
			_, err := s.JoinMatch(ctx, o, ID(), inviteToken(t, c))
			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				wins = append(wins, o)
			} else if errorCode(err) != "invalid_transition" {
				t.Error(err)
			}
		}(owner)
	}
	wg.Wait()
	if len(wins) != 1 {
		t.Fatal(wins)
	}
	guest := wins[0]
	if _, e = s.ReadyMatch(ctx, guest, c.ID, "ready", true); e != nil {
		t.Fatal(e)
	}
	v, e := s.UpdateMatchSettings(ctx, "alice", c.ID, ID(), matches.Settings{Difficulty: "medium", DurationMinutes: 15})
	if e != nil {
		t.Fatal(e)
	}
	for _, p := range v.Participants {
		if p.Ready || p.WorkspaceID != "" {
			t.Fatal(p)
		}
	}
	if _, e = s.LeaveMatch(ctx, guest, c.ID, "leave"); e != nil {
		t.Fatal(e)
	}
	v, e = s.Match(ctx, "alice", c.ID)
	if e != nil || len(v.Participants) != 1 {
		t.Fatal(v, e)
	}
	if _, e = s.Match(ctx, guest, c.ID); errorCode(e) != "not_found" {
		t.Fatal(e)
	}
	if _, e = s.JoinMatch(ctx, guest, ID(), inviteToken(t, c)); e != nil {
		t.Fatal("guest seat not free", e)
	}
	if _, e = s.ReadyMatch(ctx, "alice", c.ID, ID(), true); e != nil {
		t.Fatal(e)
	}
	v, e = s.ReadyMatch(ctx, guest, c.ID, ID(), true)
	if e != nil {
		t.Fatal(e)
	}
	if v.Deadline.Sub(*v.StartedAt) < 15*time.Minute-time.Second {
		t.Fatal("duration", v)
	}
	for _, p := range v.Participants {
		if p.UserID == v.HostUserID && p.WorkspaceID != "" {
			t.Fatal("opponent workspace leaked")
		}
	}
	own := matchWorkspace(t, s, c.ID, "alice")
	if _, e = s.Workspace(ctx, guest, own); errorCode(e) != "not_found" {
		t.Fatal(e)
	}
	w, e := s.Workspace(ctx, "alice", own)
	if e != nil || w.Kind != "match" || w.MatchID != c.ID {
		t.Fatal(w, e)
	}
	if _, e = s.UpdateMatchSettings(ctx, "alice", c.ID, ID(), matches.Settings{Difficulty: "hard", DurationMinutes: 30}); errorCode(e) != "invalid_transition" {
		t.Fatal(e)
	}
}
func TestMatchEarliestAdmissionWaitsForEarlierVerdict(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	id, _ := createPair(t, s)
	first := admitMatch(t, s, id, "alice", "submit")
	second := admitMatch(t, s, id, "bob", "submit")
	jobs := claimJobs(t, s, 2)
	if jobs[0].SubmissionID != first.ID || jobs[1].SubmissionID != second.ID {
		t.Fatal(jobs)
	}
	completeScore(t, s, jobs[1], 20)
	v, e := s.Match(ctx, "bob", id)
	if e != nil || v.State != "finalizing" || v.Outcome != nil {
		t.Fatal(v, e)
	}
	initial := *v.FinalizingAt
	if _, e = s.Admit(ctx, "bob", ID(), judging.Command{WorkspaceID: matchWorkspace(t, s, id, "bob"), Kind: "submit", Source: "late"}, "late"); errorCode(e) != "invalid_transition" {
		t.Fatal(e)
	}
	if e = s.ReconcileMatches(ctx); e != nil {
		t.Fatal(e)
	}
	v, _ = s.Match(ctx, "bob", id)
	if !v.FinalizingAt.Equal(initial) {
		t.Fatal("window extended")
	}
	completeScore(t, s, jobs[0], 20)
	v, e = s.Match(ctx, "alice", id)
	if e != nil || v.Outcome == nil || v.Outcome.WinnerUserID != v.HostUserID || v.Outcome.Reason != "first_correct" {
		t.Fatal(v, e)
	}
}
func TestMatchDeadlineBestScoreDrawAndRunNeverScores(t *testing.T) {
	for _, equal := range []bool{false, true} {
		t.Run(map[bool]string{true: "draw", false: "win"}[equal], func(t *testing.T) {
			s := testStore(t)
			ctx := context.Background()
			id, _ := createPair(t, s)
			admitMatch(t, s, id, "alice", "submit")
			admitMatch(t, s, id, "bob", "submit")
			jobs := claimJobs(t, s, 2)
			completeScore(t, s, jobs[0], 9)
			bob := 7
			if equal {
				bob = 9
			}
			completeScore(t, s, jobs[1], bob)
			run := admitMatch(t, s, id, "bob", "run")
			j := claimJobs(t, s, 1)[0]
			if j.SubmissionID != run.ID {
				t.Fatal(j)
			}
			execSQL(t, s, "UPDATE matches SET deadline=clock_timestamp()-interval '1 second' WHERE id=$1", id)
			if e := s.ReconcileMatches(ctx); e != nil {
				t.Fatal(e)
			}
			v, e := s.Match(ctx, "alice", id)
			want := "win"
			if equal {
				want = "draw"
			}
			if e != nil || v.Outcome == nil || v.Outcome.Kind != want {
				t.Fatal(v, e)
			}
			completeScore(t, s, j, 20)
			after, e := s.Match(ctx, "alice", id)
			if e != nil || after.Version != v.Version || *after.Outcome != *v.Outcome {
				t.Fatal("run altered outcome", after, e)
			}
		})
	}
}
func TestMatchInfrastructureNoContestLateVerdictFrozen(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	id, _ := createPair(t, s)
	admitMatch(t, s, id, "alice", "submit")
	job := claimJobs(t, s, 1)[0]
	execSQL(t, s, "UPDATE matches SET deadline=clock_timestamp()-interval '1 second' WHERE id=$1", id)
	v, e := s.Match(ctx, "alice", id)
	if e != nil || v.State != "finalizing" || v.Outcome != nil {
		t.Fatal(v, e)
	}
	// Persisted finalization survives a fresh Store instance.
	execSQL(t, s, "UPDATE matches SET finalizing_at=clock_timestamp()-interval '121 seconds' WHERE id=$1", id)
	reopened := &Store{Pool: s.Pool}
	if e = reopened.ReconcileMatches(ctx); e != nil {
		t.Fatal(e)
	}
	before, e := s.Match(ctx, "alice", id)
	if e != nil || before.Outcome == nil || before.Outcome.Kind != "no_contest" {
		t.Fatal(before, e)
	}
	completeScore(t, s, job, 20)
	after, e := s.Match(ctx, "alice", id)
	if e != nil || after.Version != before.Version || *after.Outcome != *before.Outcome || after.Participants[0].BestScore.Passed != 0 {
		t.Fatal("late verdict changed frozen outcome", after, e)
	}
	sub, e := s.Submission(ctx, "alice", job.SubmissionID)
	if e != nil || sub.Score.Passed != 20 {
		t.Fatal("owner history lost", sub, e)
	}
}
func TestMatchForfeitIrrevocableAndExpiry(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	id, _ := createPair(t, s)
	sub := admitMatch(t, s, id, "alice", "submit")
	job := claimJobs(t, s, 1)[0]
	if _, e := s.CancelWithKey(ctx, "alice", sub.ID, "cancel"); errorCode(e) != "invalid_transition" {
		t.Fatal(e)
	}
	v, e := s.LeaveMatch(ctx, "alice", id, "disconnect")
	if e != nil || v.State != "active" || v.Outcome != nil {
		t.Fatal(v, e)
	}
	v, e = s.ForfeitMatch(ctx, "alice", id, "forfeit")
	if e != nil || v.Outcome == nil || v.Outcome.Reason != "forfeit" || v.Outcome.WinnerUserID == v.HostUserID {
		t.Fatal(v, e)
	}
	repeat, e := s.ForfeitMatch(ctx, "alice", id, "forfeit")
	if e != nil || repeat.Version != v.Version {
		t.Fatal(repeat, e)
	}
	completeScore(t, s, job, 20)
	after, e := s.Match(ctx, "alice", id)
	if e != nil || after.Version != v.Version || *after.Outcome != *v.Outcome {
		t.Fatal(after, e)
	}
	c, e := s.CreateMatch(ctx, "alice", ID(), matches.Settings{Difficulty: "easy"})
	if e != nil {
		t.Fatal(e)
	}
	execSQL(t, s, "UPDATE matches SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", c.ID)
	if e = s.ReconcileMatches(ctx); e != nil {
		t.Fatal(e)
	}
	v, e = s.Match(ctx, "alice", c.ID)
	if e != nil || v.State != "cancelled" || v.Outcome.Reason != "invite_expired" {
		t.Fatal(v, e)
	}
	if _, e = s.CreateMatch(ctx, "alice", ID(), matches.Settings{Difficulty: "easy"}); e != nil {
		t.Fatal("expiry reservation retained", e)
	}
}
func TestMatchLockDelayedAdmissionRejected(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	id, _ := createPair(t, s)
	workspaceID := matchWorkspace(t, s, id, "alice")
	tx, e := s.Pool.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, "UPDATE matches SET deadline=clock_timestamp()+interval '100 milliseconds' WHERE id=$1", id); e != nil {
		t.Fatal(e)
	}
	result := make(chan error, 1)
	go func() {
		_, e := s.Admit(ctx, "alice", ID(), judging.Command{WorkspaceID: workspaceID, Kind: "submit", Source: "blocked"}, ID())
		result <- e
	}()
	time.Sleep(150 * time.Millisecond)
	if e = tx.Commit(ctx); e != nil {
		t.Fatal(e)
	}
	if e = <-result; errorCode(e) != "invalid_transition" {
		t.Fatal("lock-delayed submission admitted", e)
	}
	var count int
	if e = s.Pool.QueryRow(ctx, "SELECT count(*) FROM submissions WHERE match_id=$1", id).Scan(&count); e != nil || count != 0 {
		t.Fatal(count, e)
	}
}
func TestMatchEmptyDeadlineAndInfrastructureFailure(t *testing.T) {
	for _, failed := range []bool{false, true} {
		t.Run(map[bool]string{false: "empty_draw", true: "failed_no_contest"}[failed], func(t *testing.T) {
			s := testStore(t)
			ctx := context.Background()
			id, _ := createPair(t, s)
			if failed {
				admitMatch(t, s, id, "alice", "submit")
				for range 3 {
					job := claimJobs(t, s, 1)[0]
					if e := s.Complete(ctx, job, execution.Completion{SubmissionID: job.SubmissionID, AttemptID: job.AttemptID, EngineFailure: "private infrastructure details"}); e != nil {
						t.Fatal(e)
					}
					execSQL(t, s, "UPDATE execution_jobs SET available_at=clock_timestamp()")
				}
			}
			execSQL(t, s, "UPDATE matches SET deadline=clock_timestamp()-interval '121 seconds' WHERE id=$1", id)
			if e := s.ReconcileMatches(ctx); e != nil {
				t.Fatal(e)
			}
			v, e := s.Match(ctx, "alice", id)
			kind := "draw"
			if failed {
				kind = "no_contest"
			}
			if e != nil || v.Outcome == nil || v.Outcome.Kind != kind {
				t.Fatal(v, e)
			}
		})
	}
}
func TestMatchEqualAdmissionTimesUseLockedSequence(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	id, _ := createPair(t, s)
	first := admitMatch(t, s, id, "alice", "submit")
	admitMatch(t, s, id, "bob", "submit")
	jobs := claimJobs(t, s, 2)
	execSQL(t, s, "UPDATE submissions SET admitted_at=(SELECT admitted_at FROM submissions WHERE id=$1) WHERE match_id=$2", first.ID, id)
	completeScore(t, s, jobs[1], 20)
	v, e := s.Match(ctx, "alice", id)
	if e != nil || v.Outcome != nil {
		t.Fatal(v, e)
	}
	completeScore(t, s, jobs[0], 20)
	v, e = s.Match(ctx, "alice", id)
	if e != nil || v.Outcome.WinnerUserID != v.HostUserID {
		t.Fatal(v, e)
	}
	var sequence int64
	if e = s.Pool.QueryRow(ctx, "SELECT match_sequence FROM submissions WHERE id=$1", first.ID).Scan(&sequence); e != nil || sequence != 1 {
		t.Fatal(sequence, e)
	}
}
func TestMatchCompletionForfeitRaceAndOutboxVersions(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	id, _ := createPair(t, s)
	admitMatch(t, s, id, "alice", "submit")
	job := claimJobs(t, s, 1)[0]
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		_, e := s.ForfeitMatch(ctx, "alice", id, "forfeit")
		if e != nil {
			t.Error(e)
		}
	}()
	go func() {
		defer wg.Done()
		e := s.Complete(ctx, job, execution.Completion{SubmissionID: job.SubmissionID, AttemptID: job.AttemptID, Verdict: execution.Accepted, Score: &execution.Score{Passed: 20, Total: 20}})
		if e != nil {
			t.Error(e)
		}
	}()
	wg.Wait()
	v, e := s.Match(ctx, "alice", id)
	if e != nil || v.Outcome == nil || v.State != "completed" {
		t.Fatal(v, e)
	}
	if v.Outcome.Reason != "first_correct" && v.Outcome.Reason != "forfeit" {
		t.Fatal(v)
	}
	var outcomes, versions int64
	if e = s.Pool.QueryRow(ctx, "SELECT count(*) FILTER(WHERE event_type='match.completed'),count(*) FROM match_outbox WHERE match_id=$1", id).Scan(&outcomes, &versions); e != nil || outcomes != 1 || v.Version != strconv.FormatInt(versions, 10) {
		t.Fatal(outcomes, versions, v.Version, e)
	}
	if _, e = s.ForfeitMatch(ctx, "bob", id, ID()); e != nil {
		t.Fatal(e)
	}
	after, e := s.Match(ctx, "alice", id)
	if e != nil || after.Version != v.Version || *after.Outcome != *v.Outcome {
		t.Fatal(after, e)
	}
}
func TestMatchEmptyDifficultyAndEncryptedInviteReplay(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	c, e := s.CreateMatch(ctx, "alice", "encrypted", matches.Settings{Difficulty: "hard"})
	if e != nil {
		t.Fatal(e)
	}
	token := inviteToken(t, c)
	var stored string
	if e = s.Pool.QueryRow(ctx, "SELECT response::text FROM match_idempotency WHERE owner_id='alice' AND key='encrypted'").Scan(&stored); e != nil || strings.Contains(stored, token) {
		t.Fatal("invitation cached in plaintext", e)
	}
	reopened, e := Open(ctx, os.Getenv("QUOREM_TEST_DATABASE_URL"))
	if e != nil {
		t.Fatal(e)
	}
	defer reopened.Pool.Close()
	retry, e := reopened.CreateMatch(ctx, "alice", "encrypted", matches.Settings{Difficulty: "hard"})
	if e != nil || retry.InviteURL != c.InviteURL {
		t.Fatal("restart changed invite", retry, e)
	}
	execSQL(t, s, "DELETE FROM problem_versions WHERE difficulty='hard'")
	if _, e = s.JoinMatch(ctx, "bob", ID(), token); e != nil {
		t.Fatal(e)
	}
	if _, e = s.ReadyMatch(ctx, "alice", c.ID, ID(), true); e != nil {
		t.Fatal(e)
	}
	if _, e = s.ReadyMatch(ctx, "bob", c.ID, ID(), true); errorCode(e) != "no_matching_questions" {
		t.Fatal(e)
	}
	v, e := s.Match(ctx, "alice", c.ID)
	if e != nil || v.ProblemVersionID != "" || v.StartedAt != nil {
		t.Fatal(v, e)
	}
}
func TestMatchCertainLeaderIgnoresOwnUnresolvedJob(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	id, _ := createPair(t, s)
	admitMatch(t, s, id, "alice", "submit")
	job := claimJobs(t, s, 1)[0]
	completeScore(t, s, job, 19)
	admitMatch(t, s, id, "alice", "submit")
	execSQL(t, s, "UPDATE submissions SET state='failed',result='{}' WHERE match_id=$1 AND state='queued'", id)
	execSQL(t, s, "UPDATE matches SET deadline=clock_timestamp()-interval '1 second' WHERE id=$1", id)
	v, e := s.Match(ctx, "alice", id)
	if e != nil || v.Outcome == nil || v.Outcome.Kind != "win" || v.Outcome.WinnerUserID != v.HostUserID {
		t.Fatal("irrelevant failure blocked certain winner", v, e)
	}
}
func TestMatchSelectionFiltersDifficultyAfterLatestVersion(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	p, e := s.Problem(ctx, "run-widths", false)
	if e != nil {
		t.Fatal(e)
	}
	execSQL(t, s, "DELETE FROM problem_versions WHERE difficulty='easy' AND id<>$1", p.ID)
	f := copyProblemFixture(t, s, p.ID)
	f.Problem.Difficulty = "hard"
	insertTestProblem(t, s, f)
	latest := f.Problem.ID
	c, e := s.CreateMatch(ctx, "alice", ID(), matches.Settings{Difficulty: "easy"})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.JoinMatch(ctx, "bob", ID(), inviteToken(t, c)); e != nil {
		t.Fatal(e)
	}
	if _, e = s.ReadyMatch(ctx, "alice", c.ID, ID(), true); e != nil {
		t.Fatal(e)
	}
	if _, e = s.ReadyMatch(ctx, "bob", c.ID, ID(), true); errorCode(e) != "no_matching_questions" {
		t.Fatal("retained easy version entered pool", e)
	}
	v, e := s.Match(ctx, "alice", c.ID)
	if e != nil || v.ProblemVersionID != "" || v.StartedAt != nil {
		t.Fatal(v, e)
	}
	v, e = s.UpdateMatchSettings(ctx, "alice", c.ID, ID(), matches.Settings{Difficulty: "hard", DurationMinutes: 30})
	if e != nil {
		t.Fatal(e)
	}
	execSQL(t, s, "DELETE FROM problem_versions WHERE difficulty='hard' AND id<>$1", latest)
	if _, e = s.ReadyMatch(ctx, "alice", c.ID, ID(), true); e != nil {
		t.Fatal(e)
	}
	v, e = s.ReadyMatch(ctx, "bob", c.ID, ID(), true)
	if e != nil || v.ProblemVersionID != latest {
		t.Fatal("latest version not selected", v, e)
	}
}
func TestMatchAcceptedCandidateIgnoresEarlierOwnInfrastructureFailure(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	id, _ := createPair(t, s)
	failed := admitMatch(t, s, id, "alice", "submit")
	for range 3 {
		job := claimJobs(t, s, 1)[0]
		if e := s.Complete(ctx, job, execution.Completion{SubmissionID: job.SubmissionID, AttemptID: job.AttemptID, EngineFailure: "judge crashed"}); e != nil {
			t.Fatal(e)
		}
		execSQL(t, s, "UPDATE execution_jobs SET available_at=clock_timestamp()")
	}
	earlier, e := s.Submission(ctx, "alice", failed.ID)
	if e != nil || earlier.State != "failed" || earlier.Score != nil {
		t.Fatal(earlier, e)
	}
	admitMatch(t, s, id, "alice", "submit")
	completeScore(t, s, claimJobs(t, s, 1)[0], 20)
	v, e := s.Match(ctx, "alice", id)
	if e != nil || v.State != "completed" || v.Outcome == nil || v.Outcome.WinnerUserID != v.HostUserID || v.Outcome.Reason != "first_correct" {
		t.Fatal("own earlier uncertainty blocked winner", v, e)
	}
}
func TestMatchCompletionFreezesOverdueUncertaintyWithoutReconciler(t *testing.T) {
	for _, persisted := range []bool{false, true} {
		t.Run(map[bool]string{false: "deadline_downtime", true: "persisted_finalization"}[persisted], func(t *testing.T) {
			s := testStore(t)
			ctx := context.Background()
			id, _ := createPair(t, s)
			admitMatch(t, s, id, "alice", "submit")
			var job execution.Job
			if persisted {
				admitMatch(t, s, id, "bob", "submit")
				jobs := claimJobs(t, s, 2)
				job = jobs[0]
				completeScore(t, s, jobs[1], 20)
				execSQL(t, s, "UPDATE matches SET finalizing_at=clock_timestamp()-interval '121 seconds' WHERE id=$1", id)
			} else {
				job = claimJobs(t, s, 1)[0]
				execSQL(t, s, "UPDATE matches SET deadline=clock_timestamp()-interval '121 seconds' WHERE id=$1", id)
			}
			// No snapshot or reconciler runs between the elapsed window and completion.
			completeScore(t, s, job, 20)
			v, e := s.Match(ctx, "alice", id)
			if e != nil || v.Outcome == nil || v.Outcome.Kind != "no_contest" || v.Participants[0].BestScore.Passed != 0 {
				t.Fatal("late completion revived expired uncertainty", v, e)
			}
			ownerResult, e := s.Submission(ctx, "alice", job.SubmissionID)
			if e != nil || ownerResult.Score == nil || ownerResult.Score.Passed != 20 {
				t.Fatal("late owner history discarded", ownerResult, e)
			}
		})
	}
}
