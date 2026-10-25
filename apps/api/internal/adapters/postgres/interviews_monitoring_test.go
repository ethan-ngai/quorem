package postgres

import (
	"context"
	"encoding/json"
	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"strings"
	"testing"
)

func monitoringRoom(t *testing.T) (*Store, interviews.Snapshot) {
	t.Helper()
	s := interviewTestStore(t)
	v := createInterviewTest(t, s)
	if _, err := s.JoinInterview(context.Background(), "bob", strings.TrimPrefix(v.InvitePath, "/interview-invite/"), "", ""); err != nil {
		t.Fatal(err)
	}
	return s, v
}
func TestInterviewMonitoringDefaultsPrivacyAndRetry(t *testing.T) {
	s, v := monitoringRoom(t)
	ctx := context.Background()
	if !v.Monitoring.PasteEnabled() || !v.Monitoring.FocusEnabled() {
		t.Fatal("monitoring must default on")
	}
	if err := s.ReportInterviewRule(ctx, "alice", v.ID, ID(), "paste"); errorCode(err) != "forbidden" {
		t.Fatalf("host was monitored: %v", err)
	}
	if err := s.ReportInterviewRule(ctx, "charlie", v.ID, ID(), "paste"); errorCode(err) != "not_found" {
		t.Fatalf("nonmember reported: %v", err)
	}
	if err := s.ReportInterviewRule(ctx, "bob", v.ID, ID(), "clipboard-text"); errorCode(err) != "invalid_input" {
		t.Fatalf("invalid event: %v", err)
	}
	key := ID()
	if err := s.ReportInterviewRule(ctx, "bob", v.ID, key, "paste"); err != nil {
		t.Fatal(err)
	}
	if err := s.ReportInterviewRule(ctx, "bob", v.ID, key, "paste"); err != nil {
		t.Fatal(err)
	}
	if err := s.ReportInterviewRule(ctx, "bob", v.ID, ID(), "paste"); err != nil {
		t.Fatal(err)
	}
	if err := s.ReportInterviewRule(ctx, "bob", v.ID, ID(), "focus"); err != nil {
		t.Fatal(err)
	}
	host, err := s.Interview(ctx, "alice", v.ID)
	if err != nil || len(host.RuleEvents) != 2 {
		t.Fatalf("retry/rate dedupe: %d %v", len(host.RuleEvents), err)
	}
	for _, event := range host.RuleEvents {
		if event.UserID != "bob" || event.Name == "" || event.OccurredAt.IsZero() {
			t.Fatalf("untrusted actor/time: %+v", event)
		}
	}
	if host.Document != v.Document || host.QuestionEpoch != v.QuestionEpoch {
		t.Fatal("monitoring altered code")
	}
	candidate, err := s.Interview(ctx, "bob", v.ID)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(candidate)
	if len(candidate.RuleEvents) > 0 || strings.Contains(string(body), "ruleEvents") || strings.Contains(string(body), host.RuleEvents[0].ID) {
		t.Fatalf("candidate event leak: %s", body)
	}
	if _, err = s.SetInterviewMember(ctx, "alice", v.ID, ID(), "bob", "interviewer"); err != nil {
		t.Fatal(err)
	}
	promoted, err := s.Interview(ctx, "bob", v.ID)
	if err != nil || len(promoted.RuleEvents) != 2 {
		t.Fatalf("interviewer cannot read history: %v", err)
	}
	if _, err = s.SetInterviewMember(ctx, "alice", v.ID, ID(), "bob", "interviewee"); err != nil {
		t.Fatal(err)
	}
	demoted, err := s.Interview(ctx, "bob", v.ID)
	if err != nil || len(demoted.RuleEvents) != 0 {
		t.Fatalf("demotion retained alerts: %v", err)
	}
	var notices int
	if err = s.Pool.QueryRow(ctx, "SELECT count(*) FROM interview_outbox WHERE session_id=$1 AND event_type='interview.session'", v.ID).Scan(&notices); err != nil || notices == 0 {
		t.Fatal("event lacked transactional notice", err)
	}
}
func TestInterviewMonitoringConfigAndRetention(t *testing.T) {
	s, v := monitoringRoom(t)
	ctx := context.Background()
	no := false
	if _, err := s.SetInterviewMonitoring(ctx, "bob", v.ID, ID(), interviews.Monitoring{Paste: &no}); errorCode(err) != "forbidden" {
		t.Fatalf("candidate configured monitoring: %v", err)
	}
	next, err := s.SetInterviewMonitoring(ctx, "alice", v.ID, ID(), interviews.Monitoring{Paste: &no, Focus: &no})
	if err != nil || next.Monitoring.PasteEnabled() || next.Monitoring.FocusEnabled() || next.Document != v.Document {
		t.Fatal("configuration not persisted or code changed", err)
	}
	for _, kind := range []string{"paste", "focus"} {
		if err = s.ReportInterviewRule(ctx, "bob", v.ID, ID(), kind); err != nil {
			t.Fatal(err)
		}
	}
	host, err := s.Interview(ctx, "alice", v.ID)
	if err != nil || len(host.RuleEvents) != 0 {
		t.Fatal("disabled rule emitted event", err)
	}
	if _, err = s.SetInterviewMonitoring(ctx, "alice", v.ID, ID(), interviews.Monitoring{}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Pool.Exec(ctx, `INSERT INTO interview_rule_events(id,session_id,owner_id,kind,occurred_at) SELECT gen_random_uuid(),$1,'bob','paste',clock_timestamp()-interval '10 seconds' FROM generate_series(1,105)`, v.ID); err != nil {
		t.Fatal(err)
	}
	if err = s.ReportInterviewRule(ctx, "bob", v.ID, ID(), "focus"); err != nil {
		t.Fatal(err)
	}
	host, err = s.Interview(ctx, "alice", v.ID)
	if err != nil || len(host.RuleEvents) != 100 {
		t.Fatalf("unbounded history: %d %v", len(host.RuleEvents), err)
	}
	if _, err = s.CloseInterview(ctx, "alice", v.ID, ID()); err != nil {
		t.Fatal(err)
	}
	if err = s.ReportInterviewRule(ctx, "bob", v.ID, ID(), "paste"); errorCode(err) != "invalid_transition" {
		t.Fatalf("closed event admitted: %v", err)
	}
}
func TestInterviewMonitoringCreationOptOut(t *testing.T) {
	s := interviewTestStore(t)
	no := false
	v, err := s.CreateInterview(context.Background(), "alice", ID(), interviews.Create{Title: "Opt out", Question: customInterviewQuestion(), Monitoring: &interviews.Monitoring{Paste: &no, Focus: &no}})
	if err != nil || v.Monitoring.PasteEnabled() || v.Monitoring.FocusEnabled() {
		t.Fatal("creation opt-out ignored", err)
	}
}
