package postgres

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
)

func TestExecutionAndInterviewDocumentsRejectNUL(t *testing.T) {
	s := interviewTestStore(t)
	ctx := context.Background()
	p, err := s.Problem(ctx, "run-widths", false)
	if err != nil {
		t.Fatal(err)
	}
	w, err := s.CreateWorkspace(ctx, "alice", p.ID, "python")
	if err != nil {
		t.Fatal(err)
	}
	cmd := judging.Command{WorkspaceID: w.ID, Kind: "run", Source: "a\x00b"}
	if _, err = s.Admit(ctx, "alice", ID(), cmd, ID()); errorCode(err) != "invalid_input" {
		t.Fatal("NUL source admitted", err)
	}
	cmd.Source = `print("\\0")`
	if _, err = s.Admit(ctx, "alice", ID(), cmd, ID()); err != nil {
		t.Fatal("escaped source rejected", err)
	}
	room := createInterviewTest(t, s)
	changes, _ := json.Marshal([]any{[]any{0, "x\x00y"}, len(room.Document.Source)})
	push := interviews.Push{Epoch: room.Document.Epoch, Updates: []interviews.Update{{ClientID: "test", Changes: changes}}}
	if _, err = s.PushInterviewUpdates(ctx, "alice", room.ID, ID(), push); errorCode(err) != "invalid_input" || !strings.Contains(err.Error(), "NUL") {
		t.Fatal("NUL document change accepted", err)
	}
	after, err := s.Interview(ctx, "alice", room.ID)
	if err != nil || after.Document.Source != room.Document.Source || after.Document.Version != room.Document.Version {
		t.Fatal("document changed", after.Document, err)
	}
}
