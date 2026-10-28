package postgres

import (
	"context"
	"encoding/json"
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
	if _, err := s.Pool.Exec(ctx, "DELETE FROM schema_migrations WHERE name='007_schema.sql'"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = s.Pool.Exec(ctx, "INSERT INTO schema_migrations VALUES('007_schema.sql') ON CONFLICT DO NOTHING")
	})
	if err := s.Migrate(ctx, "../../../migrations"); err == nil || !strings.Contains(err.Error(), "contiguous prefix") {
		t.Fatal("gapped history accepted", err)
	}
	if _, err := s.Pool.Exec(ctx, "INSERT INTO schema_migrations VALUES('007_schema.sql')"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Pool.Exec(ctx, "INSERT INTO schema_migrations VALUES('085_interview_admission_lock.sql')"); err != nil {
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
	fixture, err := os.ReadFile("../../../../../fixtures/problems/run-widths.json")
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(fixture, &fields); err != nil {
		t.Fatal(err)
	}
	public := fields["problem"]
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
}
