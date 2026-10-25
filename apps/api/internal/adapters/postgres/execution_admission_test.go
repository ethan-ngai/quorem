package postgres

import (
	"context"
	"strings"
	"sync"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
)

func executionAdmissionFixture(t *testing.T) (*Store, string, string) {
	t.Helper()
	s := interviewTestStore(t)
	ctx := context.Background()
	room := createInterviewTest(t, s)
	if _, err := s.JoinInterview(ctx, "bob", strings.TrimPrefix(room.InvitePath, "/interview-invite/"), "", ""); err != nil {
		t.Fatal(err)
	}
	p, err := s.Problem(ctx, "run-widths", false)
	if err != nil {
		t.Fatal(err)
	}
	w, err := s.CreateWorkspace(ctx, "bob", p.ID, "python")
	if err != nil {
		t.Fatal(err)
	}
	return s, room.ID, w.ID
}

func TestExecutionAdmissionPoliciesAcrossRoomTypes(t *testing.T) {
	ctx := context.Background()
	for _, mode := range []string{"workspace", "interview"} {
		for _, policy := range []struct {
			name, sql, code string
		}{
			{"refill", "UPDATE users SET admission_tokens=0,tokens_updated_at=clock_timestamp()-interval '12 seconds' WHERE id='bob'", ""},
			{"tokens", "UPDATE users SET admission_tokens=0,tokens_updated_at=clock_timestamp() WHERE id='bob'", "quota_exceeded"},
			{"daily", `INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) SELECT gen_random_uuid(),'bob',$1,'run','','hash','completed','[]' FROM generate_series(1,100)`, "quota_exceeded"},
			{"queue", `WITH u AS (INSERT INTO users(id,display_name) SELECT gen_random_uuid()::text,'Load' FROM generate_series(1,200) RETURNING id),
 w AS (INSERT INTO workspaces(id,owner_id,problem_version_id,language) SELECT gen_random_uuid(),id,(SELECT problem_version_id FROM workspaces WHERE id=$1),'python' FROM u RETURNING id,owner_id),
 s AS (INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) SELECT gen_random_uuid(),owner_id,id,'run','','hash','queued','[]' FROM w RETURNING id)
 INSERT INTO execution_jobs(id,submission_id) SELECT gen_random_uuid(),id FROM s`, "queue_saturated"},
		} {
			t.Run(mode+"/"+policy.name, func(t *testing.T) {
				s, room, workspace := executionAdmissionFixture(t)
				var args []any
				if strings.Contains(policy.sql, "$1") {
					args = []any{workspace}
				}
				if _, err := s.Pool.Exec(ctx, policy.sql, args...); err != nil {
					t.Fatal(err)
				}
				var result judging.Submission
				var err error
				if mode == "workspace" {
					result, err = s.Admit(ctx, "bob", ID(), judging.Command{WorkspaceID: workspace, Kind: "run", Source: "source"}, "body")
				} else {
					result, err = s.AdmitInterview(ctx, "bob", room, ID(), "run")
				}
				if (policy.code == "" && err != nil) || errorCode(err) != policy.code {
					t.Fatalf("want %s, got %v", policy.code, err)
				}
				if policy.code == "" {
					var tokens float64
					if err = s.Pool.QueryRow(ctx, "SELECT admission_tokens FROM users WHERE id='bob'").Scan(&tokens); err != nil || result.ID == "" || tokens < 1 || tokens > 1.1 {
						t.Fatal("refilled execution must consume exactly one token", result.ID, tokens, err)
					}
				}
			})
		}
	}
}

func TestConcurrentInterviewAndWorkspaceShareOwnerSlot(t *testing.T) {
	s, room, workspace := executionAdmissionFixture(t)
	ctx := context.Background()
	results := make(chan error, 2)
	start := make(chan struct{})
	var group sync.WaitGroup
	group.Add(2)
	go func() {
		defer group.Done()
		<-start
		_, err := s.Admit(ctx, "bob", ID(), judging.Command{WorkspaceID: workspace, Kind: "run", Source: "source"}, "body")
		results <- err
	}()
	go func() {
		defer group.Done()
		<-start
		_, err := s.AdmitInterview(ctx, "bob", room, ID(), "run")
		results <- err
	}()
	close(start)
	group.Wait()
	close(results)
	accepted, busy := 0, 0
	for err := range results {
		if err == nil {
			accepted++
		} else if errorCode(err) == "user_busy" {
			busy++
		} else {
			t.Fatal(err)
		}
	}
	if accepted != 1 || busy != 1 {
		t.Fatal("owner admitted overlapping execution", accepted, busy)
	}
}
