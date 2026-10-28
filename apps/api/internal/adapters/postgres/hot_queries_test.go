package postgres

import (
	"context"
	"encoding/json"
	"github.com/ethan-ngai/quorem/apps/api/internal/realtime"
	"os"
	"strings"
	"testing"
)

func TestIndexedUUIDLookupsPreserveNotFound(t *testing.T) {
	s := interviewTestStore(t)
	v := createInterviewTest(t, s)
	ctx := context.Background()
	for _, bad := range []string{"", "not-a-uuid", strings.ReplaceAll(v.ID, "-", "")} {
		if _, err := s.Interview(ctx, "alice", bad); errorCode(err) != "not_found" {
			t.Fatalf("snapshot malformed lookup: %q %v", bad, err)
		}
		if _, err := s.InterviewUpdates(ctx, "alice", bad, v.Document.Epoch, 0); errorCode(err) != "not_found" {
			t.Fatalf("pull malformed lookup: %q %v", bad, err)
		}
		if _, err := s.Submission(ctx, "alice", bad); errorCode(err) != "not_found" {
			t.Fatalf("submission malformed lookup: %q %v", bad, err)
		}
		if _, err := s.Workspace(ctx, "alice", bad); errorCode(err) != "not_found" {
			t.Fatalf("workspace malformed lookup: %q %v", bad, err)
		}
		if _, err := s.InterviewSubmission(ctx, "alice", v.ID, bad); errorCode(err) != "not_found" {
			t.Fatalf("interview submission malformed lookup: %q %v", bad, err)
		}
	}
	if _, err := s.Interview(ctx, "alice", strings.ToUpper(v.ID)); err != nil {
		t.Fatal("valid uppercase UUID", err)
	}
}

type hotPlan struct {
	Plan struct {
		NodeType    string `json:"Node Type"`
		IndexName   string `json:"Index Name"`
		SharedHits  int    `json:"Shared Hit Blocks"`
		SharedReads int    `json:"Shared Read Blocks"`
		Plans       []json.RawMessage
	} `json:"Plan"`
	ExecutionTime float64 `json:"Execution Time"`
}

func explainHot(t *testing.T, q querier, label, query string, args ...any) hotPlan {
	t.Helper()
	var raw []byte
	if err := q.QueryRow(context.Background(), "EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) "+query, args...).Scan(&raw); err != nil {
		t.Fatal(label, err)
	}
	var plans []hotPlan
	if err := json.Unmarshal(raw, &plans); err != nil {
		t.Fatal(err)
	}
	t.Logf("%s %.3f ms shared_hit=%d shared_read=%d plan=%s", label, plans[0].ExecutionTime, plans[0].Plan.SharedHits, plans[0].Plan.SharedReads, raw)
	return plans[0]
}

// Opt-in plan evidence; large synthetic histories are isolated from the ordinary correctness suite.
func TestHotQueryPlans(t *testing.T) {
	if os.Getenv("QUOREM_TEST_QUERY_PLANS") != "1" {
		t.Skip("QUOREM_TEST_QUERY_PLANS=1 enables synthetic EXPLAIN evidence")
	}
	s := interviewTestStore(t)
	v := createInterviewTest(t, s)
	ctx := context.Background()
	t.Cleanup(func() {
		_, err := s.Pool.Exec(context.Background(), `TRUNCATE interviews,workspaces CASCADE; DELETE FROM identity_bindings WHERE issuer='hot-issuer'; DELETE FROM entitlement_grants WHERE user_id LIKE 'hot-user-%'; DELETE FROM users WHERE id LIKE 'hot-user-%'`)
		if err != nil {
			t.Error("synthetic cleanup", err)
		}
	})

	statements := []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO users(id,display_name) SELECT 'hot-user-'||n,'Synthetic '||n FROM generate_series(1,5000)n ON CONFLICT DO NOTHING`, nil},
		{`INSERT INTO identity_bindings(issuer,subject,user_id) SELECT 'hot-issuer','subject-'||n,'hot-user-'||n FROM generate_series(1,5000)n ON CONFLICT DO NOTHING`, nil},
		{`INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,revoked_at,actor,reason) SELECT gen_random_uuid(),'hot-user-'||u,'interviews.host','manual','history-'||g,CASE WHEN g<60 THEN now() ELSE NULL END,'synthetic','query plan' FROM generate_series(1,5000)u CROSS JOIN generate_series(1,60)g`, nil},
		{`INSERT INTO interviews(id,host_id,title,question,language,source,document_epoch,invite_hash,invite_token,question_epoch,interviewer_invite_hash,interviewer_invite_token) SELECT md5('hot-room-'||n)::uuid,'hot-user-'||n,'Synthetic room',question,language,source,md5('hot-doc-'||n)::uuid,'hot-invite-'||n,'hot-token-'||n,md5('hot-question-'||n)::uuid,'hot-staff-'||n,'hot-staff-token-'||n FROM generate_series(1,5000)n CROSS JOIN interviews WHERE id=$1`, []any{v.ID}},
		{`INSERT INTO interview_members(session_id,user_id,role) SELECT md5('hot-room-'||n)::uuid,'hot-user-'||n,'interviewer' FROM generate_series(1,5000)n`, nil},
		{`INSERT INTO workspaces(id,owner_id,problem_version_id,language) SELECT md5('hot-workspace-'||n)::uuid,'hot-user-'||n,(SELECT id FROM problem_versions LIMIT 1),'python' FROM generate_series(1,5000)n`, nil},
		{`INSERT INTO interview_question_snapshots(session_id,id,fixture) SELECT id,sha256(convert_to('{}'::jsonb::text,'UTF8')),'{}' FROM interviews ON CONFLICT DO NOTHING`, nil},
		{`WITH inserted AS (INSERT INTO submissions(id,owner_id,interview_id,kind,source,source_hash,state,cases,admitted_at)
 SELECT md5('hot-submission-'||n)::uuid,'hot-user-'||((n-1)%5000+1),CASE WHEN n>100000 THEN $1::uuid ELSE md5('hot-room-'||((n-1)%5000+1))::uuid END,'submit','','synthetic',CASE WHEN n>109900 THEN 'queued' ELSE 'completed' END,'[]','2020-01-01'::timestamptz+n*interval '1 second' FROM generate_series(1,110000)n RETURNING id,interview_id,admitted_at)
 INSERT INTO interview_execution(submission_id,session_id,document_version,document_epoch,fixture_id,question_epoch)
 SELECT id,interview_id,0,$2::uuid,sha256(convert_to('{}'::jsonb::text,'UTF8')),CASE WHEN admitted_at>'2020-01-01'::timestamptz+interval '109992 seconds' THEN $3::uuid ELSE md5('hot-old-epoch')::uuid END FROM inserted`, []any{v.ID, v.Document.Epoch, v.QuestionEpoch}},
		{`INSERT INTO execution_jobs(id,submission_id,finished,available_at) SELECT md5('hot-job-'||n)::uuid,md5('hot-submission-'||n)::uuid,n<=109900,'2020-01-01'::timestamptz+n*interval '1 second' FROM generate_series(1,110000)n`, nil},
		{`INSERT INTO interview_updates(session_id,epoch,version,client_id,changes) SELECT md5('hot-room-'||n)::uuid,md5('hot-doc-'||n)::uuid,version,'synthetic','[]' FROM generate_series(1,5000)n CROSS JOIN generate_series(1,20)version`, nil},
		{`INSERT INTO interview_presence(session_id,user_id,client_id,epoch,version,anchor,head) SELECT md5('hot-room-'||n)::uuid,'hot-user-'||n,'synthetic',md5('hot-doc-'||n)::uuid,0,0,0 FROM generate_series(1,5000)n`, nil},
		{`UPDATE interview_outbox SET published_at=now() WHERE sequence<(SELECT max(sequence)-63 FROM interview_outbox)`, nil},
		{`ANALYZE`, nil},
	}
	for _, statement := range statements {
		if _, err := s.Pool.Exec(ctx, statement.sql, statement.args...); err != nil {
			t.Fatal(err)
		}
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `DROP INDEX entitlement_grants_unrevoked; DROP INDEX interview_execution_question`); err != nil {
		t.Fatal(err)
	}
	room := "b12b6c59-bf2e-e5c7-31d7-80296c940f2a"
	if err = s.Pool.QueryRow(ctx, "SELECT md5('hot-room-5000')::uuid").Scan(&room); err != nil {
		t.Fatal(err)
	}
	var submissionID string
	if err = s.Pool.QueryRow(ctx, "SELECT md5('hot-submission-110000')::uuid").Scan(&submissionID); err != nil {
		t.Fatal(err)
	}
	before := explainHot(t, tx, "before_document", strings.ReplaceAll(interviewDocumentStateQuery, "i.id=$1", "i.id::text=$1"), room, "hot-user-5000", false)
	explainHot(t, tx, "before_submission", `SELECT id,workspace_id,kind,state,source_hash,admitted_at,updated_at,result FROM submissions WHERE id::text=$1 AND owner_id=$2`, submissionID, "hot-user-5000")
	explainHot(t, tx, "before_latest", interviewLatestSubmissionQuery, v.ID)
	entitlement := `SELECT EXISTS(SELECT 1 FROM entitlement_grants WHERE user_id=$1 AND feature IN ('internal','interviews.host') AND revoked_at IS NULL AND valid_from<=clock_timestamp() AND (expires_at IS NULL OR expires_at>clock_timestamp()))`
	explainHot(t, tx, "before_entitlement", entitlement, "hot-user-5000")
	if err = tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	after := explainHot(t, s.Pool, "after_document", interviewDocumentStateQuery, uuidLookup(room), "hot-user-5000", false)
	if after.Plan.SharedHits+after.Plan.SharedReads >= before.Plan.SharedHits+before.Plan.SharedReads {
		t.Fatal("typed document lookup did not reduce buffer work")
	}
	explainHot(t, s.Pool, "after_submission", `SELECT id,workspace_id,kind,state,source_hash,admitted_at,updated_at,result FROM submissions WHERE id=$1 AND owner_id=$2`, uuidLookup(submissionID), "hot-user-5000")
	explainHot(t, s.Pool, "after_latest", interviewLatestSubmissionQuery, v.ID)
	explainHot(t, s.Pool, "after_entitlement", entitlement, "hot-user-5000")
	explainHot(t, s.Pool, "identity", `SELECT u.id,u.display_name,u.role,u.disabled FROM users u JOIN identity_bindings b ON b.user_id=u.id WHERE b.issuer=$1 AND b.subject=$2`, "hot-issuer", "subject-5000")
	var documentEpoch string
	if err = s.Pool.QueryRow(ctx, "SELECT md5('hot-doc-5000')::uuid").Scan(&documentEpoch); err != nil {
		t.Fatal(err)
	}
	explainHot(t, s.Pool, "document_updates", `SELECT client_id,changes FROM interview_updates WHERE session_id=$1 AND epoch=$2 AND version>$3 ORDER BY version LIMIT 256`, uuidLookup(room), uuidLookup(documentEpoch), 0)
	explainHot(t, s.Pool, "presence", `SELECT client_id FROM interview_presence WHERE session_id=$1 AND updated_at>clock_timestamp()-interval '20 seconds' ORDER BY user_id,client_id LIMIT 48`, uuidLookup(room))
	explainHot(t, s.Pool, "before_pending_outbox", strings.ReplaceAll(interviewPendingEventsQuery, "ORDER BY interview_outbox.sequence", "ORDER BY sequence"))
	explainHot(t, s.Pool, "after_pending_outbox", interviewPendingEventsQuery)
	explainHot(t, s.Pool, "owner_busy", `SELECT EXISTS(SELECT 1 FROM submissions WHERE owner_id=$1 AND state IN ('queued','running'))`, "hot-user-5000")
	explainHot(t, s.Pool, "queue_count", `SELECT count(*) FROM execution_jobs WHERE NOT finished`)
	explainHot(t, s.Pool, "claim", `SELECT id FROM execution_jobs WHERE NOT finished AND available_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp()) ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1`)
}

func TestInterviewOutboxOrdersNumericSequences(t *testing.T) {
	s := interviewTestStore(t)
	v := createInterviewTest(t, s)
	ctx := context.Background()
	if _, err := s.Pool.Exec(ctx, "DELETE FROM interview_outbox"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Pool.Exec(ctx, `INSERT INTO interview_outbox(sequence,session_id,event_type) VALUES(2,$1,'interview.document'),(10,$1,'interview.document'),(100,$1,'interview.document')`, v.ID); err != nil {
		t.Fatal(err)
	}
	var versions []string
	if err := s.DispatchInterviewEvents(ctx, func(notice realtime.Notice) error { versions = append(versions, notice.Version); return nil }); err != nil {
		t.Fatal(err)
	}
	if strings.Join(versions, ",") != "2,10,100" {
		t.Fatalf("numeric sequence order: %v", versions)
	}
}
