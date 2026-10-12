package postgres

import (
	"context"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/apps/api/internal/matches"
	"testing"
)

func ffa(t *testing.T, s *Store, rules matches.Rules) (string, matches.Snapshot) {
	t.Helper()
	ctx := context.Background()
	c, e := s.CreateMatch(ctx, "alice", ID(), matches.Settings{Mode: matches.FreeForAll, Difficulties: []string{"easy", "medium"}, Rules: rules})
	if e != nil {
		t.Fatal(e)
	}
	for _, o := range []string{"bob", "charlie"} {
		if _, e = s.JoinMatch(ctx, o, ID(), inviteToken(t, c)); e != nil {
			t.Fatal(e)
		}
	}
	for _, o := range []string{"alice", "bob", "charlie"} {
		v, e := s.ReadyMatch(ctx, o, c.ID, ID(), true)
		if e != nil || v.State == "active" {
			t.Fatal("FFA started automatically", e)
		}
	}
	v, e := s.StartMatch(ctx, "alice", c.ID, ID())
	if e != nil || v.State != "active" || len(v.Participants) != 3 {
		t.Fatal(v, e)
	}
	return c.ID, v
}
func TestFreeForAllHostStartSettingsAndForfeit(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	c, e := s.CreateMatch(ctx, "alice", ID(), matches.Settings{Mode: matches.FreeForAll, Difficulties: []string{"easy", "medium"}})
	if e != nil {
		t.Fatal(e)
	}
	for _, o := range []string{"bob", "charlie"} {
		if _, e = s.JoinMatch(ctx, o, ID(), inviteToken(t, c)); e != nil {
			t.Fatal(e)
		}
	}
	if _, e = s.UpdateMatchSettings(ctx, "alice", c.ID, ID(), matches.Settings{Difficulty: "easy"}); errorCode(e) != "invalid_transition" {
		t.Fatal("downsize should reject", e)
	}
	if _, e = s.StartMatch(ctx, "bob", c.ID, ID()); errorCode(e) != "forbidden" {
		t.Fatal(e)
	}
	if _, e = s.StartMatch(ctx, "alice", c.ID, ID()); errorCode(e) != "invalid_transition" {
		t.Fatal(e)
	}
	for _, o := range []string{"alice", "bob", "charlie"} {
		if _, e = s.ReadyMatch(ctx, o, c.ID, ID(), true); e != nil {
			t.Fatal(e)
		}
	}
	if _, e = s.StartMatch(ctx, "alice", c.ID, ID()); e != nil {
		t.Fatal(e)
	}
	v, e := s.ForfeitMatch(ctx, "charlie", c.ID, ID())
	if e != nil || v.Outcome != nil || !v.Participants[2].Forfeited {
		t.Fatal(v, e)
	}
	if _, e = s.Admit(ctx, "charlie", ID(), judging.Command{WorkspaceID: matchWorkspace(t, s, c.ID, "charlie"), Kind: "run", Source: "pass"}, "hash"); errorCode(e) != "invalid_transition" {
		t.Fatal(e)
	}
	v, e = s.ForfeitMatch(ctx, "bob", c.ID, ID())
	if e != nil || v.Outcome == nil || v.Outcome.Reason != "forfeit" || v.Outcome.WinnerUserID != v.HostUserID {
		t.Fatal(v, e)
	}
}
func TestMatchRulesRejectRemovedCooldown(t *testing.T) {
	s := testStore(t)
	for _, rules := range []matches.Rules{{Clipboard: "cooldown"}, {Focus: "cooldown"}} {
		_, err := s.CreateMatch(context.Background(), "alice", ID(), matches.Settings{Mode: matches.FreeForAll, Difficulties: []string{"easy"}, DurationMinutes: 30, Rules: rules})
		if errorCode(err) != "invalid_input" {
			t.Fatal(err)
		}
	}
}
func TestMatchRulesWarningsAndBoundedAnnouncements(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	id, _ := ffa(t, s, matches.Rules{Clipboard: "warning", Focus: "announce"})
	v, e := s.ReportMatchRule(ctx, "alice", id, ID(), "clipboard")
	if e != nil || len(v.RuleEvents) != 0 {
		t.Fatal(v, e)
	}
	for i := 0; i < 23; i++ {
		execSQL(t, s, "UPDATE match_participants SET last_rule_event_at=clock_timestamp()-interval '3 seconds' WHERE match_id=$1", id)
		if _, e = s.ReportMatchRule(ctx, "bob", id, ID(), "focus"); e != nil {
			t.Fatal(e)
		}
	}
	v, e = s.Match(ctx, "alice", id)
	if e != nil || len(v.RuleEvents) != 20 {
		t.Fatal(v, e)
	}
	for _, event := range v.RuleEvents {
		if event.Action != "announce" || event.Kind != "focus" {
			t.Fatal(event)
		}
	}
}
func TestFreeForAllFirstCorrectAndExplicitProblem(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	p, e := s.Problem(ctx, "mirror-letters", false)
	if e != nil {
		t.Fatal(e)
	}
	c, e := s.CreateMatch(ctx, "alice", ID(), matches.Settings{Mode: matches.FreeForAll, SelectedProblemVersionID: p.ID})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.JoinMatch(ctx, "bob", ID(), inviteToken(t, c)); e != nil {
		t.Fatal(e)
	}
	for _, o := range []string{"alice", "bob"} {
		if _, e = s.ReadyMatch(ctx, o, c.ID, ID(), true); e != nil {
			t.Fatal(e)
		}
	}
	v, e := s.StartMatch(ctx, "alice", c.ID, ID())
	if e != nil || v.ProblemVersionID != p.ID {
		t.Fatal(v, e)
	}
	admitMatch(t, s, c.ID, "bob", "submit")
	jobs := claimJobs(t, s, 1)
	completeScore(t, s, jobs[0], 20)
	v, e = s.Match(ctx, "alice", c.ID)
	if e != nil || v.Outcome == nil || v.Outcome.Reason != "first_correct" {
		t.Fatal(v, e)
	}
}

func TestModeSwitchWithVacantSeatRetainsCapacity(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	c, e := s.CreateMatch(ctx, "alice", ID(), matches.Settings{Mode: matches.FreeForAll, Difficulty: "easy"})
	if e != nil {
		t.Fatal(e)
	}
	for _, o := range []string{"bob", "charlie"} {
		if _, e = s.JoinMatch(ctx, o, ID(), inviteToken(t, c)); e != nil {
			t.Fatal(e)
		}
	}
	if _, e = s.LeaveMatch(ctx, "bob", c.ID, ID()); e != nil {
		t.Fatal(e)
	}
	v, e := s.UpdateMatchSettings(ctx, "alice", c.ID, ID(), matches.Settings{Mode: matches.Showdown, Difficulty: "easy"})
	if e != nil || len(v.Participants) != 2 {
		t.Fatal(v, e)
	}
	if _, e = s.JoinMatch(ctx, "dana", ID(), inviteToken(t, c)); errorCode(e) != "invalid_transition" {
		t.Fatal("third Showdown player admitted", e)
	}
}
func TestFreeForAllDeadlineExcludesForfeitedWork(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	id, _ := ffa(t, s, matches.Rules{})
	owners := map[string]string{}
	for _, o := range []string{"alice", "bob", "charlie"} {
		a := admitMatch(t, s, id, o, "submit")
		owners[a.ID] = o
	}
	jobs := claimJobs(t, s, 3)
	for _, j := range jobs {
		if owners[j.SubmissionID] == "charlie" {
			continue
		}
		score := 4
		if owners[j.SubmissionID] == "bob" {
			score = 7
		}
		completeScore(t, s, j, score)
	}
	if _, e := s.ForfeitMatch(ctx, "charlie", id, ID()); e != nil {
		t.Fatal(e)
	}
	execSQL(t, s, "UPDATE matches SET deadline=clock_timestamp()-interval '1 second' WHERE id=$1", id)
	v, e := s.Match(ctx, "alice", id)
	if e != nil || v.Outcome == nil || v.Outcome.Reason != "deadline_score" || v.Outcome.WinnerUserID != v.Participants[1].UserID {
		t.Fatal(v, e)
	}
}

func TestFreeForAllCapacityRaceReservationsAndPrivacy(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	for _, o := range []string{"ffa-four", "ffa-five", "ffa-six", "ffa-seven", "ffa-eight", "ffa-nine"} {
		execSQL(t, s, "INSERT INTO users(id,display_name) VALUES($1,$1) ON CONFLICT DO NOTHING", o)
	}
	c, e := s.CreateMatch(ctx, "alice", ID(), matches.Settings{Mode: matches.FreeForAll, Difficulty: "easy"})
	if e != nil {
		t.Fatal(e)
	}
	owners := []string{"alice", "bob", "charlie", "dana", "ffa-four", "ffa-five", "ffa-six"}
	token := inviteToken(t, c)
	for _, o := range owners[1:] {
		if _, e = s.JoinMatch(ctx, o, ID(), token); e != nil {
			t.Fatal(e)
		}
	}
	type admission struct {
		owner string
		err   error
	}
	results := make(chan admission, 2)
	for _, o := range []string{"ffa-seven", "ffa-eight"} {
		go func(owner string) { _, err := s.JoinMatch(ctx, owner, ID(), token); results <- admission{owner, err} }(o)
	}
	winner := ""
	rejects := 0
	for i := 0; i < 2; i++ {
		result := <-results
		if result.err == nil {
			if winner != "" {
				t.Fatal("two final seats admitted")
			}
			winner = result.owner
		} else if errorCode(result.err) == "invalid_transition" {
			rejects++
		} else {
			t.Fatal(result.err)
		}
	}
	if winner == "" || rejects != 1 {
		t.Fatal(winner, rejects)
	}
	owners = append(owners, winner)
	if _, e = s.JoinMatch(ctx, "ffa-nine", ID(), token); errorCode(e) != "invalid_transition" {
		t.Fatal("ninth admitted", e)
	}
	for _, o := range owners {
		if _, e = s.CreateMatch(ctx, o, ID(), matches.Settings{Difficulty: "easy"}); errorCode(e) != "user_busy" {
			t.Fatal("reservation lost", o, e)
		}
		if _, e = s.ReadyMatch(ctx, o, c.ID, ID(), true); e != nil {
			t.Fatal(e)
		}
	}
	if _, e = s.StartMatch(ctx, "alice", c.ID, ID()); e != nil {
		t.Fatal(e)
	}
	for _, o := range owners {
		v, e := s.Match(ctx, o, c.ID)
		if e != nil || len(v.Participants) != 8 {
			t.Fatal(v, e)
		}
		var subject string
		if e = s.Pool.QueryRow(ctx, "SELECT participant_id FROM users WHERE id=$1", o).Scan(&subject); e != nil {
			t.Fatal(e)
		}
		own := 0
		for _, p := range v.Participants {
			if p.UserID == subject {
				if p.WorkspaceID == "" {
					t.Fatal("own workspace missing", o)
				}
				own++
			} else if p.WorkspaceID != "" {
				t.Fatal("foreign workspace leaked", o, p)
			}
		}
		if own != 1 {
			t.Fatal("own participant missing", o)
		}
	}
}
