package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/eventbus"
	"github.com/ethan-ngai/quorem/apps/api/internal/adapters/postgres"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
	"github.com/ethan-ngai/quorem/internal/execution"
)

func dialSubmission(ctx context.Context, server, id, user string) (*websocket.Conn, *http.Response, error) {
	h := http.Header{"Origin": []string{"http://localhost:5173"}}
	return websocket.Dial(ctx, "ws"+strings.TrimPrefix(server, "http")+"/v1/submissions/"+id+"/events?user="+user, &websocket.DialOptions{HTTPHeader: h})
}

func TestSubmissionOutboxRetriesFailedPublish(t *testing.T) {
	store := streamStore(t)
	ctx := context.Background()
	p, err := store.Problem(ctx, "run-widths", false)
	if err != nil {
		t.Fatal(err)
	}
	w, err := store.CreateWorkspace(ctx, "alice", p.ID, "python")
	if err != nil {
		t.Fatal(err)
	}
	v, err := store.Admit(ctx, "alice", postgres.ID(), judging.Command{WorkspaceID: w.ID, Kind: "run", Source: "source"}, postgres.ID())
	if err != nil {
		t.Fatal(err)
	}
	if err := store.DispatchSubmissionEvents(ctx, func(realtime.Notice) error { return fmt.Errorf("unavailable") }); err == nil {
		t.Fatal("failed publish was acknowledged")
	}
	var seen []realtime.Notice
	if err := store.DispatchSubmissionEvents(ctx, func(n realtime.Notice) error { seen = append(seen, n); return nil }); err != nil {
		t.Fatal(err)
	}
	if len(seen) != 1 || seen[0].AggregateID != v.ID {
		t.Fatal(seen)
	}
}

func TestSubmissionMigrationAfterMembershipMigration(t *testing.T) {
	store := streamStore(t)
	ctx := context.Background()
	_, err := store.Pool.Exec(ctx, `DROP TRIGGER submission_notice ON submissions;
		DROP FUNCTION queue_submission_notice();
		DROP TABLE submission_outbox;
		DELETE FROM schema_migrations WHERE name='011_submission_realtime.sql'`)
	if err != nil {
		t.Fatal(err)
	}
	var later bool
	if err = store.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE name='012_match_membership_events.sql')`).Scan(&later); err != nil || !later {
		t.Fatalf("membership migration: %v %v", later, err)
	}
	if err = store.Migrate(ctx, "../../migrations"); err != nil {
		t.Fatal(err)
	}
	var exists bool
	if err = store.Pool.QueryRow(ctx, `SELECT to_regclass('submission_outbox') IS NOT NULL`).Scan(&exists); err != nil || !exists {
		t.Fatalf("submission migration: %v %v", exists, err)
	}
}

func TestSubmissionStreamRepairsSilentlyLostNotice(t *testing.T) {
	store := streamStore(t)
	ctx := context.Background()
	p, err := store.Problem(ctx, "run-widths", false)
	if err != nil {
		t.Fatal(err)
	}
	w, err := store.CreateWorkspace(ctx, "alice", p.ID, "python")
	if err != nil {
		t.Fatal(err)
	}
	v, err := store.Admit(ctx, "alice", postgres.ID(), judging.Command{WorkspaceID: w.ID, Kind: "run", Source: "source"}, postgres.ID())
	if err != nil {
		t.Fatal(err)
	}
	api := &Server{Store: store, Local: true, Events: realtime.NewMemory()}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.SetPathValue("id", v.ID)
		api.serveSubmissionEvents(w, r, 30*time.Millisecond)
	}))
	defer server.Close()
	conn, _, err := dialSubmission(ctx, server.URL, v.ID, "alice")
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	readSubmission(t, conn, "queued")
	job, err := store.Claim(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Complete(ctx, job, execution.Completion{SubmissionID: job.SubmissionID, AttemptID: job.AttemptID, Verdict: execution.Accepted}); err != nil {
		t.Fatal(err)
	}
	// No dispatcher publishes to the socket; its bounded safety snapshot must recover.
	readSubmission(t, conn, "completed")
}

func TestSubmissionStreamCrossReplica(t *testing.T) {
	store := streamStore(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	p, err := store.Problem(ctx, "run-widths", false)
	if err != nil {
		t.Fatal(err)
	}
	w, err := store.CreateWorkspace(ctx, "alice", p.ID, "python")
	if err != nil {
		t.Fatal(err)
	}
	v, err := store.Admit(ctx, "alice", postgres.ID(), judging.Command{WorkspaceID: w.ID, Kind: "run", Source: "source"}, postgres.ID())
	if err != nil {
		t.Fatal(err)
	}
	dsn := store.Pool.Config().ConnString()
	for _, i := range []int{0, 1} {
		bus, e := eventbus.NewPostgres(ctx, dsn, "", 256)
		if e != nil {
			t.Fatal(e)
		}
		api := &Server{Store: store, Local: true, Events: bus}
		if err := api.StartRealtime(ctx); err != nil {
			t.Fatal(err)
		}
		if i == 1 {
			server := httptest.NewServer(api.Handler())
			defer server.Close()
			conn, _, e := dialSubmission(ctx, server.URL, v.ID, "alice")
			if e != nil {
				t.Fatal(e)
			}
			defer conn.CloseNow()
			readSubmission(t, conn, "queued")
			job, e := store.Claim(ctx)
			if e != nil {
				t.Fatal(e)
			}
			readSubmission(t, conn, "running")
			if e = store.Complete(ctx, job, execution.Completion{SubmissionID: job.SubmissionID, AttemptID: job.AttemptID, Verdict: execution.Accepted}); e != nil {
				t.Fatal(e)
			}
			readSubmission(t, conn, "completed")
		}
	}
}

func readSubmission(t *testing.T, c *websocket.Conn, state string) judging.Submission {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for range 20 {
		_, data, err := c.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(data), "private source") {
			t.Fatal("source leaked")
		}
		var v judging.Submission
		if err := json.Unmarshal(data, &v); err != nil {
			t.Fatal(err)
		}
		if v.State == state {
			return v
		}
	}
	t.Fatalf("state %s missing", state)
	return judging.Submission{}
}

func TestSubmissionStreamOwnerAndReconnectSnapshot(t *testing.T) {
	store := streamStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	p, err := store.Problem(ctx, "run-widths", false)
	if err != nil {
		t.Fatal(err)
	}
	w, err := store.CreateWorkspace(ctx, "alice", p.ID, "python")
	if err != nil {
		t.Fatal(err)
	}
	admitted, err := store.Admit(ctx, "alice", postgres.ID(), judging.Command{WorkspaceID: w.ID, Kind: "run", Source: "private source"}, postgres.ID())
	if err != nil {
		t.Fatal(err)
	}
	_, server, _ := streamServer(t, store)
	denied, response, err := dialSubmission(ctx, server.URL, admitted.ID, "bob")
	if denied != nil {
		denied.CloseNow()
	}
	if err == nil || response == nil || response.StatusCode != http.StatusNotFound {
		t.Fatalf("owner isolation: %v %v", response, err)
	}
	conn, _, err := dialSubmission(ctx, server.URL, admitted.ID, "alice")
	if err != nil {
		t.Fatal(err)
	}
	if got := readSubmission(t, conn, "queued"); got.ID != admitted.ID {
		t.Fatal(got)
	}
	job, err := store.Claim(ctx)
	if err != nil || job.SubmissionID != admitted.ID {
		t.Fatal(job, err)
	}
	readSubmission(t, conn, "running")
	conn.CloseNow()
	if err = store.Complete(ctx, job, execution.Completion{SubmissionID: job.SubmissionID, AttemptID: job.AttemptID, Verdict: execution.Accepted}); err != nil {
		t.Fatal(err)
	}
	recovered, _, err := dialSubmission(ctx, server.URL, admitted.ID, "alice")
	if err != nil {
		t.Fatal(err)
	}
	defer recovered.CloseNow()
	if got := readSubmission(t, recovered, "completed"); got.Verdict != execution.Accepted {
		t.Fatal(got)
	}
}

func TestSubmissionStreamRetryFailureAndCancellation(t *testing.T) {
	store := streamStore(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	p, err := store.Problem(ctx, "run-widths", false)
	if err != nil {
		t.Fatal(err)
	}
	w, err := store.CreateWorkspace(ctx, "alice", p.ID, "python")
	if err != nil {
		t.Fatal(err)
	}
	admit := func() judging.Submission {
		v, e := store.Admit(ctx, "alice", postgres.ID(), judging.Command{WorkspaceID: w.ID, Kind: "run", Source: "source"}, postgres.ID())
		if e != nil {
			t.Fatal(e)
		}
		return v
	}
	_, server, _ := streamServer(t, store)
	first := admit()
	conn, _, err := dialSubmission(ctx, server.URL, first.ID, "alice")
	if err != nil {
		t.Fatal(err)
	}
	readSubmission(t, conn, "queued")
	if _, err = store.CancelWithKey(ctx, "alice", first.ID, postgres.ID()); err != nil {
		t.Fatal(err)
	}
	readSubmission(t, conn, "cancelled")
	conn.CloseNow()
	second := admit()
	conn, _, err = dialSubmission(ctx, server.URL, second.ID, "alice")
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	readSubmission(t, conn, "queued")
	for attempt := 0; attempt < 3; attempt++ {
		if _, err = store.Pool.Exec(ctx, "UPDATE execution_jobs SET available_at=clock_timestamp() WHERE submission_id=$1", second.ID); err != nil {
			t.Fatal(err)
		}
		job, e := store.Claim(ctx)
		if e != nil || job.SubmissionID != second.ID {
			t.Fatal(job, e)
		}
		readSubmission(t, conn, "running")
		if e = store.Complete(ctx, job, execution.Completion{SubmissionID: job.SubmissionID, AttemptID: job.AttemptID, EngineFailure: "private infrastructure error"}); e != nil {
			t.Fatal(e)
		}
		if attempt < 2 {
			readSubmission(t, conn, "queued")
		} else {
			v := readSubmission(t, conn, "failed")
			if v.InfrastructureError != "Judge unavailable" {
				t.Fatal(v)
			}
		}
	}
}
