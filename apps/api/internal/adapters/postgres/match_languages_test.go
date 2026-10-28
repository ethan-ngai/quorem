package postgres

import (
	"context"
	"errors"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestMatchLanguagesPreserveWorkspaceOwnershipAndQueueSnapshots(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	id, _ := createPair(t, s)
	original := matchWorkspace(t, s, id, "alice")
	switched, err := s.SwitchMatchLanguage(ctx, "alice", id, "java-selection", "java")
	if err != nil || switched.Language != "java" || switched.ID == original {
		t.Fatal(switched, err)
	}
	if matchWorkspace(t, s, id, "alice") != switched.ID {
		t.Fatal("active pointer not updated")
	}
	if _, err = s.Workspace(ctx, "bob", switched.ID); errorCode(err) != "not_found" {
		t.Fatal("cross-owner language workspace", err)
	}
	_, err = s.Pool.Exec(ctx, `UPDATE match_participants SET workspace_id=$1 WHERE match_id=$2 AND owner_id='bob'`, switched.ID, id)
	var constraint *pgconn.PgError
	if !errors.As(err, &constraint) || constraint.Code != "23503" {
		t.Fatalf("participant accepted another owner's workspace: %v", err)
	}
	retried, err := s.SwitchMatchLanguage(ctx, "alice", id, "java-selection", "java")
	if err != nil || retried.ID != switched.ID {
		t.Fatal("retry", retried, err)
	}
	if _, err = s.SwitchMatchLanguage(ctx, "alice", id, "java-selection", "ocaml"); errorCode(err) != "idempotency_conflict" {
		t.Fatal(err)
	}
	restored, err := s.SwitchMatchLanguage(ctx, "alice", id, ID(), "python")
	if err != nil || restored.ID != original {
		t.Fatal("original draft namespace lost", restored, err)
	}
	if _, err = s.SwitchMatchLanguage(ctx, "bob", id, ID(), "rust"); errorCode(err) != "invalid_input" {
		t.Fatal(err)
	}
	if _, err = s.SwitchMatchLanguage(ctx, "charlie", id, ID(), "python"); errorCode(err) != "not_found" {
		t.Fatal("nonparticipant", err)
	}
	if _, err = s.SwitchMatchLanguage(ctx, "alice", id, ID(), "typescript"); err != nil {
		t.Fatal(err)
	}
	command := judging.Command{WorkspaceID: matchWorkspace(t, s, id, "alice"), Kind: "run", Source: "source"}
	if _, err = s.Admit(ctx, "alice", ID(), command, ID()); err != nil {
		t.Fatal(err)
	}
	if _, err = s.SwitchMatchLanguage(ctx, "alice", id, ID(), "ocaml"); errorCode(err) != "user_busy" {
		t.Fatal("changed language while running", err)
	}
	job, err := s.Claim(ctx)
	if err != nil || job.RuntimeRevision != "typescript-5.9.3-node-22.21.1-v1" {
		t.Fatal("queue did not pin selected language", job, err)
	}
	execSQL(t, s, "UPDATE matches SET deadline=clock_timestamp()-interval '1 second' WHERE id=$1", id)
	if _, err = s.SwitchMatchLanguage(ctx, "bob", id, ID(), "ocaml"); errorCode(err) != "invalid_transition" {
		t.Fatal("late language switch", err)
	}
}
