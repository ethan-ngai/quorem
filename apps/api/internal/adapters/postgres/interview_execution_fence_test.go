package postgres

import (
	"context"
	"strings"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
)

func TestInterviewAdmissionFencesSourceAndQuestionButReplaysPriorJob(t *testing.T) {
	s := interviewTestStore(t)
	ctx := context.Background()
	room := createInterviewTest(t, s)
	if _, err := s.JoinInterview(ctx, "bob", strings.TrimPrefix(room.InvitePath, "/interview-invite/"), "", ""); err != nil {
		t.Fatal(err)
	}
	command := interviews.ExecutionCommand{Kind: "run", QuestionEpoch: room.QuestionEpoch, DocumentEpoch: room.Document.Epoch, SourceHash: Hash([]byte(room.Document.Source))}
	changed := room.Document.Source + "\n# concurrent edit\n"
	if _, err := s.Pool.Exec(ctx, `UPDATE interviews SET source=$2,document_version=document_version+1 WHERE id=$1`, room.ID, changed); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AdmitInterview(ctx, "bob", room.ID, ID(), command); errorCode(err) != "document_changed" {
		t.Fatalf("stale source: %v", err)
	}
	command.SourceHash = Hash([]byte(changed))
	key := ID()
	first, err := s.AdmitInterview(ctx, "bob", room.ID, key, command)
	if err != nil {
		t.Fatal(err)
	}
	if first.SourceHash != command.SourceHash {
		t.Fatal("admitted source hash differs from requested source")
	}
	if _, err = s.Pool.Exec(ctx, `UPDATE interviews SET source=$2,document_version=document_version+1 WHERE id=$1`, room.ID, changed+"# later\n"); err != nil {
		t.Fatal(err)
	}
	retry, err := s.AdmitInterview(ctx, "bob", room.ID, key, command)
	if err != nil || retry.ID != first.ID {
		t.Fatalf("retry: %+v %v", retry, err)
	}
	command.SourceHash = Hash([]byte(changed + "# later\n"))
	if _, err = s.AdmitInterview(ctx, "bob", room.ID, key, command); errorCode(err) != "idempotency_conflict" {
		t.Fatalf("changed retry: %v", err)
	}
	command.DocumentEpoch = ID()
	if _, err = s.AdmitInterview(ctx, "bob", room.ID, ID(), command); errorCode(err) != "document_changed" {
		t.Fatalf("stale document epoch: %v", err)
	}
	command.DocumentEpoch = room.Document.Epoch
	command.QuestionEpoch = ID()
	if _, err = s.AdmitInterview(ctx, "bob", room.ID, ID(), command); errorCode(err) != "document_changed" {
		t.Fatalf("stale question: %v", err)
	}
}
