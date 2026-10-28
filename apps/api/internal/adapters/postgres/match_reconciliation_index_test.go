package postgres

import (
	"context"
	"os"
	"strings"
	"testing"
)

// Opt-in plan check: populate unrelated history to exercise the index at scale.
func TestMatchReconciliationHistoryPlan(t *testing.T) {
	if os.Getenv("QUOREM_TEST_QUERY_PLANS") != "1" {
		t.Skip("QUOREM_TEST_QUERY_PLANS=1 enables synthetic EXPLAIN evidence")
	}
	s := testStore(t)
	ctx := context.Background()
	matchID, _ := createPair(t, s)
	admitMatch(t, s, matchID, "alice", "submit")
	for _, query := range []string{
		`INSERT INTO users(id,display_name) SELECT 'match-plan-'||n,'Plan' FROM generate_series(1,2000)n`,
		`INSERT INTO workspaces(id,owner_id,problem_version_id,language) SELECT md5('match-plan-'||n)::uuid,'match-plan-'||n,(SELECT id FROM problem_versions LIMIT 1),'python' FROM generate_series(1,2000)n`,
		`INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) SELECT gen_random_uuid(),'match-plan-'||n,md5('match-plan-'||n)::uuid,'run','','hash','completed','[]' FROM generate_series(1,2000)n CROSS JOIN generate_series(1,10)`,
		`ANALYZE submissions`,
	} {
		if _, err := s.Pool.Exec(ctx, query); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		if _, err := s.Pool.Exec(context.Background(), `TRUNCATE matches,workspaces CASCADE; DELETE FROM users WHERE id LIKE 'match-plan-%'`); err != nil {
			t.Error(err)
		}
	})
	const query = `EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT s.owner_id,s.state,s.match_sequence,COALESCE(s.result->>'verdict',''),s.result->'score',COALESCE(s.odyssey_level < jsonb_array_length(p.odyssey->'levels'),false) FROM submissions s JOIN workspaces w ON w.id=s.workspace_id JOIN problem_versions p ON p.id=w.problem_version_id WHERE s.match_id=$1 AND s.kind='submit' ORDER BY s.admitted_at,s.match_sequence`
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `DROP INDEX match_submission_history`); err != nil {
		t.Fatal(err)
	}
	var before []byte
	if err = tx.QueryRow(ctx, query, uuidLookup(matchID)).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(before), `"Node Type": "Seq Scan"`) {
		t.Fatalf("expected pre-index sequential scan: %s", before)
	}
	if err = tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	var after []byte
	if err = s.Pool.QueryRow(ctx, query, uuidLookup(matchID)).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(after), `"Index Name": "match_submission_history"`) {
		t.Fatalf("expected match history index: %s", after)
	}
	t.Logf("before=%s after=%s", before, after)
}
