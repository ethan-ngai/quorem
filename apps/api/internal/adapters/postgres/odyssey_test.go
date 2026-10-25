package postgres

import (
	"context"
	"encoding/json"
	"github.com/ethan-ngai/quorem/apps/api/internal/identity"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/ethan-ngai/quorem/internal/execution"
	"os"
	"strings"
	"testing"
)

func TestOdysseyPublicationProgressAndCumulativeAdmission(t *testing.T) {
	s := testStore(t)
	ctx := identity.With(context.Background(), identity.Principal{UserID: "alice", Admin: true})
	grantInternal(t, s, "alice")
	if _, err := s.Pool.Exec(ctx, "UPDATE users SET role='admin' WHERE id='alice'"); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile("../../../../../fixtures/odyssey/balance-ledger.json")
	if err != nil {
		t.Fatal(err)
	}
	var content problems.QuestionContent
	if err = json.Unmarshal(data, &content); err != nil {
		t.Fatal(err)
	}
	d, err := s.CreateQuestionDraft(ctx, "alice", content)
	if err != nil {
		t.Fatal(err)
	}
	d, err = s.PublishQuestionDraft(ctx, "alice", d.ID, d.Revision)
	if err != nil {
		t.Fatal(err)
	}
	p, err := s.Problem(ctx, d.PublishedVersionID, true)
	if err != nil {
		t.Fatal(err)
	}
	if p.Odyssey == nil || len(p.Odyssey.Levels) != 1 {
		t.Fatalf("future levels exposed: %+v", p.Odyssey)
	}
	for _, kind := range []string{"classic", "odyssey"} {
		page, err := s.ProblemCatalog(context.Background(), ProblemFilter{Type: kind, Page: 1, Limit: 1})
		if err != nil || len(page.Items) != 1 {
			t.Fatalf("type filter %s: %+v %v", kind, page, err)
		}
		for _, item := range page.Items {
			if (item.Odyssey != nil) != (kind == "odyssey") {
				t.Fatalf("wrong type %s: %+v", kind, item)
			}
		}
		if kind == "odyssey" && page.Total != 1 {
			t.Fatalf("filtered total: %d", page.Total)
		}
	}
	if _, err := s.ProblemCatalog(ctx, ProblemFilter{Type: "unknown", Page: 1, Limit: 20}); errorCode(err) != "invalid_input" {
		t.Fatal("invalid type", err)
	}

	data, _ = json.Marshal(p)
	if strings.Contains(string(data), "Withdrawals") {
		t.Fatal("future requirement leaked")
	}
	full, err := s.QuestionContent(ctx, p.ID)
	if err != nil || len(full.Problem.Odyssey.Levels) != 2 || len(full.OdysseyHiddenCases) != 2 {
		t.Fatalf("author roundtrip: %+v %v", full, err)
	}
	if _, err = s.CreateWorkspace(ctx, "bob", p.ID, "python"); errorCode(err) != "entitlement_required" {
		t.Fatal("ungated workspace", err)
	}
	w, err := s.CreateWorkspace(ctx, "alice", p.ID, "python")
	if err != nil {
		t.Fatal(err)
	}
	cmd := judging.Command{WorkspaceID: w.ID, Kind: "submit", Source: "source retained across levels", Level: 2}
	if _, err = s.Admit(ctx, "alice", ID(), cmd, ID()); errorCode(err) != "revision_conflict" {
		t.Fatal("level skip", err)
	}
	submit := func(level int, verdict execution.Verdict, passed int) {
		t.Helper()
		if _, err = s.Pool.Exec(ctx, "UPDATE users SET admission_tokens=2 WHERE id='alice'"); err != nil {
			t.Fatal(err)
		}
		cmd.Level = level
		sub, err := s.Admit(ctx, "alice", ID(), cmd, ID())
		if err != nil {
			t.Fatal(err)
		}
		j, err := s.Claim(ctx)
		if err != nil || j.SubmissionID != sub.ID {
			t.Fatal(j, err)
		}
		spec, err := s.LoadExecution(ctx, j)
		if err != nil {
			t.Fatal(err)
		}
		total := 2
		if level == 2 {
			total = 4
		}
		if len(spec.Cases) != total || spec.Source != cmd.Source || len(spec.Fixture.Problem.Odyssey.Levels) != level {
			t.Fatal("snapshot/cumulative suite", spec)
		}
		statuses := []execution.HiddenCaseResult{}
		for i := 0; i < total; i++ {
			status := execution.WrongAnswer
			if i < passed {
				status = execution.Accepted
			}
			statuses = append(statuses, execution.HiddenCaseResult{Index: i, Status: status})
		}
		err = s.Complete(ctx, j, execution.Completion{SubmissionID: sub.ID, AttemptID: j.AttemptID, Verdict: verdict, Score: &execution.Score{Passed: passed, Total: total}, HiddenCases: statuses})
		if err != nil {
			t.Fatal(err)
		}
	}
	submit(1, execution.Accepted, 2)
	progress, err := s.Odyssey(ctx, "alice", w.ID)
	if err != nil || progress.Level != 2 || progress.Completed || len(progress.Levels) != 2 {
		t.Fatal(progress, err)
	}
	submit(2, execution.WrongAnswer, 2)
	progress, err = s.Odyssey(ctx, "alice", w.ID)
	if err != nil || progress.Completed {
		t.Fatal("regression unlocked completion", progress, err)
	}
	submit(2, execution.Accepted, 4)
	progress, err = s.Odyssey(ctx, "alice", w.ID)
	if err != nil || !progress.Completed {
		t.Fatal(progress, err)
	}
}
