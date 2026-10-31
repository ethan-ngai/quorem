package postgres

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestMigrationsPreserveDataAndRejectUnavailableHistory(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	var before int
	if err := s.Pool.QueryRow(ctx, "SELECT count(*) FROM problem_versions").Scan(&before); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := s.Migrate(ctx, "../../../migrations"); err != nil {
			t.Fatal("repeat migration", err)
		}
	}
	paths, err := filepath.Glob("../../../migrations/*.sql")
	if err != nil {
		t.Fatal(err)
	}
	var after, names int
	if err := s.Pool.QueryRow(ctx, "SELECT count(*) FROM problem_versions").Scan(&after); err != nil || after != before {
		t.Fatal("migration changed seeded data", before, after, err)
	}
	if err := s.Pool.QueryRow(ctx, "SELECT count(*) FROM schema_migrations").Scan(&names); err != nil || names != len(paths) {
		t.Fatal("expected every repository migration", names, err)
	}
	var checksum string
	if err := s.Pool.QueryRow(ctx, "SELECT checksum FROM schema_migrations WHERE name='007_schema.sql'").Scan(&checksum); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = s.Pool.Exec(ctx, "INSERT INTO schema_migrations(name,checksum) VALUES('007_schema.sql',$1) ON CONFLICT(name) DO UPDATE SET checksum=excluded.checksum", checksum)
	})
	if _, err := s.Pool.Exec(ctx, "UPDATE schema_migrations SET checksum='tampered' WHERE name='007_schema.sql'"); err != nil {
		t.Fatal(err)
	}
	if err := s.Migrate(ctx, "../../../migrations"); err == nil || !strings.Contains(err.Error(), "checksum mismatch") {
		t.Fatal("tampered history accepted", err)
	}
	if _, err := s.Pool.Exec(ctx, "UPDATE schema_migrations SET checksum=NULL WHERE name='007_schema.sql'"); err != nil {
		t.Fatal(err)
	}
	if err := s.Migrate(ctx, "../../../migrations"); err == nil || !strings.Contains(err.Error(), "audited baseline") {
		t.Fatal("name-only history accepted", err)
	}
	if _, err := s.Pool.Exec(ctx, "DELETE FROM schema_migrations WHERE name='007_schema.sql'"); err != nil {
		t.Fatal(err)
	}
	if err := s.Migrate(ctx, "../../../migrations"); err == nil || !strings.Contains(err.Error(), "contiguous prefix") {
		t.Fatal("gapped history accepted", err)
	}
	if _, err := s.Pool.Exec(ctx, "INSERT INTO schema_migrations(name,checksum) VALUES('007_schema.sql',$1)", checksum); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Pool.Exec(ctx, "INSERT INTO schema_migrations(name) VALUES('085_interview_admission_lock.sql')"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		s.Pool.Exec(ctx, "DELETE FROM schema_migrations WHERE name='085_interview_admission_lock.sql'")
	})
	if err := s.Migrate(ctx, "../../../migrations"); err == nil || !strings.Contains(err.Error(), "unavailable migration") {
		t.Fatal("unknown history accepted", err)
	}
	if err := s.Pool.QueryRow(ctx, "SELECT count(*) FROM schema_migrations").Scan(&names); err != nil || names != len(paths)+1 {
		t.Fatal("rejection must preserve ledger", names, err)
	}
	if err := s.Migrate(ctx, t.TempDir()); err == nil {
		t.Fatal("empty migration directory accepted")
	}
	if _, err := s.Pool.Exec(ctx, "DELETE FROM schema_migrations WHERE name='085_interview_admission_lock.sql'"); err != nil {
		t.Fatal(err)
	}
	tampered := t.TempDir()
	for _, path := range paths {
		data, e := os.ReadFile(path)
		if e != nil {
			t.Fatal(e)
		}
		if filepath.Base(path) == "007_schema.sql" {
			data = append(data, '\n')
		}
		if e = os.WriteFile(filepath.Join(tampered, filepath.Base(path)), data, 0600); e != nil {
			t.Fatal(e)
		}
	}
	if err := os.WriteFile(filepath.Join(tampered, "999_pending.sql"), []byte("CREATE TABLE public.go_checksum_pending(id int)"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := s.Migrate(ctx, tampered); err == nil || !strings.Contains(err.Error(), "checksum mismatch") {
		t.Fatal("changed migration bytes accepted", err)
	}
	var pending *string
	if err := s.Pool.QueryRow(ctx, "SELECT to_regclass('public.go_checksum_pending')::text").Scan(&pending); err != nil || pending != nil {
		t.Fatal("pending SQL ran after checksum mismatch", pending, err)
	}
}

func TestCaseCallsMigrationBackfillsSealedVersions(t *testing.T) {
	base := testStore(t)
	ctx := context.Background()
	if _, err := base.Pool.Exec(ctx, "CREATE SCHEMA case_calls_upgrade"); err != nil {
		t.Fatal(err)
	}
	defer base.Pool.Exec(ctx, "DROP SCHEMA case_calls_upgrade CASCADE")
	config := base.Pool.Config()
	config.ConnConfig.RuntimeParams["search_path"] = "case_calls_upgrade"
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	paths, err := filepath.Glob("../../../migrations/*.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range paths {
		if filepath.Base(path) >= "021_problem_case_calls.sql" {
			break
		}
		data, e := os.ReadFile(path)
		if e != nil {
			t.Fatal(e)
		}
		if _, e = pool.Exec(ctx, string(data)); e != nil {
			t.Fatal(path, e)
		}
	}
	public := []byte(`{"id":"00000000-0000-4000-8000-000000000001","slug":"run-widths","version":"1","title":"Example","difficulty":"easy","statementMarkdown":"Example","signature":{},"constraints":[],"limits":{},"starterSource":"source","runtimeRevision":"runtime","examples":[{"args":[],"expected":1}],"tags":[]}`)
	fixture := []byte(`{"problem":{},"hiddenCases":[{"args":[],"expected":2}],"harnessRevision":"harness","referenceSource":"reference","attribution":"test"}`)
	id := ID()
	if _, err = pool.Exec(ctx, `WITH docs AS (SELECT jsonb_set($2::jsonb || jsonb_build_object('id',$1::uuid::text,'version','1') || '{"sql":{"dialect":"postgresql"},"odyssey":{"levels":[{"title":"First"}]}}'::jsonb,'{examples,0,calls}','[{"methodName":"public","args":[]}]') AS public,
 jsonb_set($3::jsonb,'{hiddenCases,0,calls}','[{"methodName":"private","args":[]}]') AS fixture)
 INSERT INTO problem_versions(id,slug,version,public,fixture)
 SELECT $1,'run-widths',1,public,jsonb_set(fixture,'{problem}',public) || '{"odysseyHiddenCases":[[{"args":[],"calls":[{"methodName":"hidden","args":[]}]}]]}'::jsonb FROM docs`, id, public, fixture); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `UPDATE problem_versions SET sealed=true WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile("../../../migrations/021_problem_case_calls.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	var example, hidden string
	if err = pool.QueryRow(ctx, `SELECT (SELECT calls->0->>'methodName' FROM problem_examples WHERE version_id=$1 AND ordinal=0),
 (SELECT calls->0->>'methodName' FROM problem_test_cases WHERE version_id=$1 AND ordinal=0)`, id).Scan(&example, &hidden); err != nil || example != "public" || hidden != "private" {
		t.Fatalf("backfill: %q %q %v", example, hidden, err)
	}
	if _, err = pool.Exec(ctx, `UPDATE problem_examples SET calls='[]' WHERE version_id=$1`, id); err == nil {
		t.Fatal("sealed example became mutable")
	}
	migration, err = os.ReadFile("../../../migrations/023_problem_kind_config.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	var dialect, title string
	if err = pool.QueryRow(ctx, `SELECT sql_config->>'dialect',odyssey->'levels'->0->>'title' FROM problem_versions WHERE id=$1`, id).Scan(&dialect, &title); err != nil || dialect != "postgresql" || title != "First" {
		t.Fatalf("configuration backfill: %q %q %v", dialect, title, err)
	}
	if _, err = pool.Exec(ctx, `UPDATE problem_versions SET odyssey=NULL WHERE id=$1`, id); err == nil {
		t.Fatal("sealed version became mutable")
	}
	migration, err = os.ReadFile("../../../migrations/024_odyssey_cases.sql")
	if err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `ALTER TABLE problem_versions DISABLE TRIGGER immutable_problem_version`); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `UPDATE problem_versions SET fixture=jsonb_set(fixture,'{problem,title}','"different"') WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, string(migration)); err == nil {
		t.Fatal("inconsistent snapshots accepted")
	}
	if err = tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	var method string
	if err = pool.QueryRow(ctx, `SELECT case_data->'calls'->0->>'methodName' FROM problem_odyssey_cases WHERE version_id=$1 AND level=0 AND ordinal=0`, id).Scan(&method); err != nil || method != "hidden" {
		t.Fatalf("Odyssey case backfill: %q %v", method, err)
	}
	if _, err = pool.Exec(ctx, `DELETE FROM problem_odyssey_cases WHERE version_id=$1`, id); err == nil {
		t.Fatal("sealed Odyssey case became mutable")
	}
	if _, err = pool.Exec(ctx, `INSERT INTO users(id,display_name) VALUES('match-host','Host');
 INSERT INTO matches(id,host_owner_id,invite_hash,expires_at,difficulty,difficulties,duration_minutes,state)
 VALUES(gen_random_uuid(),'match-host','invite',clock_timestamp()+interval '1 hour','easy',ARRAY['hard'],30,'waiting')`); err != nil {
		t.Fatal(err)
	}
	for _, file := range []string{"025_remove_problem_snapshots.sql", "026_remove_match_difficulty.sql"} {
		migration, err = os.ReadFile(filepath.Join("../../../migrations", file))
		if err != nil {
			t.Fatal(err)
		}
		if file == "026_remove_match_difficulty.sql" {
			if _, err = pool.Exec(ctx, string(migration)); err == nil {
				t.Fatal("inconsistent match difficulty accepted")
			}
			if _, err = pool.Exec(ctx, `UPDATE matches SET difficulty='hard'`); err != nil {
				t.Fatal(err)
			}
		}
		if _, err = pool.Exec(ctx, string(migration)); err != nil {
			t.Fatal(file, err)
		}
	}
	var difficulty string
	if err = pool.QueryRow(ctx, `SELECT difficulties[1] FROM matches`).Scan(&difficulty); err != nil || difficulty != "hard" {
		t.Fatalf("match difficulty lost: %q %v", difficulty, err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO quota_overrides(user_id,resource,value,actor,reason) VALUES
 ('match-host','guest_jobs',1,'test','old'),('match-host','guest_concurrency',2,'test','current')`); err != nil {
		t.Fatal(err)
	}
	migration, err = os.ReadFile("../../../migrations/028_remove_guest_allowances.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	var quotaCount int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM quota_overrides WHERE resource='guest_concurrency'`).Scan(&quotaCount); err != nil || quotaCount != 1 {
		t.Fatalf("current quota lost: %d %v", quotaCount, err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO quota_overrides(user_id,resource,value,actor,reason) VALUES('match-host','guest_jobs',1,'test','old')`); err == nil {
		t.Fatal("retired quota accepted")
	}
	if _, err = pool.Exec(ctx, `INSERT INTO interviews(id,host_id,title,question,language,source,document_epoch,question_epoch,invite_hash,invite_token,interviewer_invite_hash,interviewer_invite_token)
 VALUES('00000000-0000-4000-8000-000000000101','match-host','Interview','{}','python','','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000103','invitee','token','interviewer','token2')`); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES('00000000-0000-4000-8000-000000000104','match-host',$1,'python')`, id); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases)
 VALUES('00000000-0000-4000-8000-000000000105','match-host','00000000-0000-4000-8000-000000000104','run','','hash','queued','[]');
 INSERT INTO interview_execution(submission_id,session_id,document_version,document_epoch,fixture,question_epoch)
 VALUES('00000000-0000-4000-8000-000000000105','00000000-0000-4000-8000-000000000101',0,'00000000-0000-4000-8000-000000000102','{}','00000000-0000-4000-8000-000000000103')`); err != nil {
		t.Fatal(err)
	}
	var noticesBefore int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM interview_outbox`).Scan(&noticesBefore); err != nil {
		t.Fatal(err)
	}
	migration, err = os.ReadFile("../../../migrations/029_interview_submission_context.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	var migrated bool
	var noticesAfter int
	if err = pool.QueryRow(ctx, `SELECT workspace_id IS NULL AND interview_id='00000000-0000-4000-8000-000000000101',
 (SELECT count(*) FROM interview_outbox) FROM submissions WHERE id='00000000-0000-4000-8000-000000000105'`).Scan(&migrated, &noticesAfter); err != nil || !migrated || noticesAfter != noticesBefore {
		t.Fatalf("interview context migration: %v notices=%d/%d %v", migrated, noticesBefore, noticesAfter, err)
	}
	migration, err = os.ReadFile("../../../migrations/031_workspace_language_integrity.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO users(id,display_name) VALUES('other-host','Other')`); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES('00000000-0000-4000-8000-000000000106','other-host',$1,'python')`, id); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases)
 VALUES('00000000-0000-4000-8000-000000000107','other-host','00000000-0000-4000-8000-000000000106','run','','hash','completed','[]')`); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, string(migration)); err == nil {
		t.Fatal("referenced invalid workspace accepted")
	}
	if _, err = pool.Exec(ctx, `DELETE FROM submissions WHERE id='00000000-0000-4000-8000-000000000107'`); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	var workspaces, executions int
	if err = pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM workspaces WHERE id='00000000-0000-4000-8000-000000000104'),
 (SELECT count(*) FROM interview_execution WHERE submission_id='00000000-0000-4000-8000-000000000105')`).Scan(&workspaces, &executions); err != nil || workspaces != 0 || executions != 1 {
		t.Fatalf("legacy workspace cleanup: %d workspaces, %d executions: %v", workspaces, executions, err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO interview_operations(owner_id,key,fingerprint,session_id,response) VALUES
 ('match-host','update','hash','00000000-0000-4000-8000-000000000101','{"epoch":"e","version":1,"updates":[{"clientID":"x","changes":[1]}]}'),
 ('match-host','submission','hash','00000000-0000-4000-8000-000000000101','{"submissionId":"s"}')`); err != nil {
		t.Fatal(err)
	}
	migration, err = os.ReadFile("../../../migrations/033_remove_duplicate_update_responses.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	var cleared, submissionRetained bool
	if err = pool.QueryRow(ctx, `SELECT (SELECT response='null'::jsonb FROM interview_operations WHERE key='update'),
 (SELECT response->>'submissionId'='s' FROM interview_operations WHERE key='submission')`).Scan(&cleared, &submissionRetained); err != nil || !cleared || !submissionRetained {
		t.Fatalf("operation response migration: %v %v %v", cleared, submissionRetained, err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO submissions(id,owner_id,interview_id,kind,source,source_hash,state,cases)
 VALUES('00000000-0000-4000-8000-000000000108','match-host','00000000-0000-4000-8000-000000000101','run','','hash','completed','[]');
 INSERT INTO interview_execution(submission_id,session_id,document_version,document_epoch,fixture,question_epoch)
 VALUES('00000000-0000-4000-8000-000000000108','00000000-0000-4000-8000-000000000101',0,'00000000-0000-4000-8000-000000000102','{}','00000000-0000-4000-8000-000000000103')`); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM interview_outbox`).Scan(&noticesBefore); err != nil {
		t.Fatal(err)
	}
	migration, err = os.ReadFile("../../../migrations/034_interview_question_snapshots.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	var snapshots, linked int
	if err = pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM interview_question_snapshots),
 (SELECT count(*) FROM interview_execution e JOIN interview_question_snapshots q ON q.session_id=e.session_id AND q.id=e.fixture_id WHERE q.fixture='{}'),
 (SELECT count(*) FROM interview_outbox)`).Scan(&snapshots, &linked, &noticesAfter); err != nil || snapshots != 1 || linked != 2 || noticesAfter != noticesBefore {
		t.Fatalf("snapshot migration: %d snapshots, %d links, notices=%d/%d %v", snapshots, linked, noticesBefore, noticesAfter, err)
	}
	if _, err = pool.Exec(ctx, `UPDATE interview_execution SET document_version=1 WHERE submission_id='00000000-0000-4000-8000-000000000105'`); err == nil {
		t.Fatal("interview execution context became mutable")
	}
	if _, err = pool.Exec(ctx, `UPDATE interview_execution SET private_results='[]' WHERE submission_id='00000000-0000-4000-8000-000000000105'`); err != nil {
		t.Fatal("private result update rejected", err)
	}
	migration, err = os.ReadFile("../../../migrations/036_normalize_operation_responses.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(ctx, `SELECT (SELECT response IS NULL FROM interview_operations WHERE key='update'),
 (SELECT response->>'submissionId'='s' FROM interview_operations WHERE key='submission')`).Scan(&cleared, &submissionRetained); err != nil || !cleared || !submissionRetained {
		t.Fatalf("operation null migration: %v %v %v", cleared, submissionRetained, err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES('00000000-0000-4000-8000-000000000109','match-host',$1,'postgresql')`, id); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO submissions(id,owner_id,workspace_id,match_id,kind,source,source_hash,state,cases)
 SELECT '00000000-0000-4000-8000-000000000110','match-host','00000000-0000-4000-8000-000000000109',id,'run','','hash','completed','[]' FROM matches LIMIT 1`); err != nil {
		t.Fatal(err)
	}
	migration, err = os.ReadFile("../../../migrations/037_workspace_context_integrity.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, string(migration)); err == nil {
		t.Fatal("inconsistent workspace context accepted")
	}
	if _, err = pool.Exec(ctx, `DELETE FROM submissions WHERE id='00000000-0000-4000-8000-000000000110'`); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO submissions(id,owner_id,interview_id,kind,source,source_hash,state,cases)
 VALUES('00000000-0000-4000-8000-000000000111','match-host','00000000-0000-4000-8000-000000000101','run','','hash','completed','[]')`); err != nil {
		t.Fatal(err)
	}
	migration, err = os.ReadFile("../../../migrations/038_interview_submission_integrity.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, string(migration)); err == nil {
		t.Fatal("orphan interview submission accepted")
	}
	if _, err = pool.Exec(ctx, `DELETE FROM submissions WHERE id='00000000-0000-4000-8000-000000000111'`); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `DELETE FROM interview_execution WHERE submission_id='00000000-0000-4000-8000-000000000105'`); err == nil {
		t.Fatal("interview execution detached from its submission")
	}
	if _, err = pool.Exec(ctx, `DELETE FROM submissions WHERE id='00000000-0000-4000-8000-000000000105'`); err != nil {
		t.Fatal("submission deletion did not cascade", err)
	}
}
