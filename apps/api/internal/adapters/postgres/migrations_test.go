package postgres

import (
	"context"
	"fmt"
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
	if _, err := s.Pool.Exec(ctx, "INSERT INTO schema_migrations VALUES('085_interview_admission_lock.sql')"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		s.Pool.Exec(ctx, "DELETE FROM schema_migrations WHERE name='085_interview_admission_lock.sql'")
	})
	if err := s.Migrate(ctx, "../../../migrations"); err == nil || !strings.Contains(err.Error(), "adopt-schema.py") {
		t.Fatal("old history needs explicit verified adoption", err)
	}
	if err := s.Pool.QueryRow(ctx, "SELECT count(*) FROM schema_migrations").Scan(&names); err != nil || names != len(paths)+1 {
		t.Fatal("rejection must preserve ledger", names, err)
	}
	if err := s.Migrate(ctx, t.TempDir()); err == nil {
		t.Fatal("empty migration directory accepted")
	}
}

func TestRemoveOdysseyEntitlementMigration(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `ALTER TABLE entitlement_grants DROP CONSTRAINT entitlement_grants_feature_check;
		ALTER TABLE entitlement_grants ADD CONSTRAINT entitlement_grants_feature_check
		CHECK (feature IN ('problems.odyssey', 'interviews.host'));
		INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason)
		VALUES (gen_random_uuid(),'alice','problems.odyssey','manual','old','test','test'),
		(gen_random_uuid(),'alice','interviews.host','manual','keep','test','test');
		INSERT INTO access_audit(operation_id,actor,user_id,action,scope,reason)
		VALUES ('old-odyssey','test','alice','grant:problems.odyssey','hash','test'),
		('keep-interview','test','alice','grant:interviews.host','hash','test')`)
	if err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile("../../../migrations/legacy/006_remove_odyssey_entitlement.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	var old, retained int
	if err = tx.QueryRow(ctx, `SELECT count(*) FILTER (WHERE feature='problems.odyssey'),
		count(*) FILTER (WHERE feature='interviews.host') FROM entitlement_grants`).Scan(&old, &retained); err != nil || old != 0 || retained != 1 {
		t.Fatalf("migration removed wrong grants: old=%d retained=%d err=%v", old, retained, err)
	}
	var triggerEnabled string
	if err = tx.QueryRow(ctx, `SELECT count(*) FILTER (WHERE action='grant:problems.odyssey'),
		count(*) FILTER (WHERE action='grant:interviews.host') FROM access_audit`).Scan(&old, &retained); err != nil || old != 0 || retained != 1 {
		t.Fatalf("migration removed wrong audit entries: old=%d retained=%d err=%v", old, retained, err)
	}
	if err = tx.QueryRow(ctx, `SELECT tgenabled::text FROM pg_trigger WHERE tgrelid='access_audit'::regclass AND tgname='immutable_access_audit'`).Scan(&triggerEnabled); err != nil || triggerEnabled != "O" {
		t.Fatalf("audit trigger not restored: %q %v", triggerEnabled, err)
	}
	if _, err = tx.Exec(ctx, `INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason)
		VALUES (gen_random_uuid(),'alice','problems.odyssey','manual','new','test','test')`); err == nil {
		t.Fatal("obsolete entitlement accepted")
	}
}

func TestFlattenedMigrationUpgradesLegacyPrefixes(t *testing.T) {
	base := testStore(t)
	ctx := context.Background()
	dir := "../../../migrations"
	legacy := []string{"001_schema.sql", "002_hot_query_indexes.sql", "002_profile_image.sql", "003_execution_wakeups.sql", "004_realtime_presence_leases.sql", "005_odyssey_feedback_reset.sql", "006_remove_odyssey_entitlement.sql"}
	for count := 1; count <= len(legacy); count++ {
		t.Run(fmt.Sprint(count), func(t *testing.T) {
			schema := fmt.Sprintf("upgrade_%d", count)
			if _, err := base.Pool.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
				t.Fatal(err)
			}
			defer base.Pool.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
			config := base.Pool.Config()
			config.ConnConfig.RuntimeParams["search_path"] = schema
			pool, err := pgxpool.NewWithConfig(ctx, config)
			if err != nil {
				t.Fatal(err)
			}
			defer pool.Close()
			for _, name := range legacy[:count] {
				data, err := os.ReadFile(filepath.Join(dir, "legacy", name))
				if err != nil {
					t.Fatal(err)
				}
				if _, err = pool.Exec(ctx, string(data)); err != nil {
					t.Fatal(name, err)
				}
			}
			if _, err = pool.Exec(ctx, `CREATE TABLE schema_migrations(name text PRIMARY KEY); INSERT INTO users(id,display_name) VALUES('upgrade-user','Preserved')`); err != nil {
				t.Fatal(err)
			}
			for _, name := range legacy[:count] {
				if _, err = pool.Exec(ctx, "INSERT INTO schema_migrations VALUES($1)", name); err != nil {
					t.Fatal(err)
				}
			}
			if count < len(legacy) {
				if _, err = pool.Exec(ctx, `INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES(gen_random_uuid(),'upgrade-user','problems.odyssey','manual','old','test','test')`); err != nil {
					t.Fatal(err)
				}
			}
			s := &Store{Pool: pool}
			if err = s.Migrate(ctx, dir); err != nil {
				t.Fatal(err)
			}
			if err = s.Migrate(ctx, dir); err != nil {
				t.Fatal(err)
			}
			var users, grants, ledger int
			if err = pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM users WHERE id='upgrade-user'), (SELECT count(*) FROM entitlement_grants WHERE feature='problems.odyssey'), (SELECT count(*) FROM schema_migrations WHERE name='007_schema.sql')`).Scan(&users, &grants, &ledger); err != nil || users != 1 || grants != 0 || ledger != 1 {
				t.Fatalf("upgrade state: %d %d %d %v", users, grants, ledger, err)
			}
		})
	}
}

func TestFlattenedMigrationRejectsGappedHistory(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	if _, err := s.Pool.Exec(ctx, `DELETE FROM schema_migrations; INSERT INTO schema_migrations VALUES ('001_schema.sql'),('003_execution_wakeups.sql')`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = s.Pool.Exec(ctx, `DELETE FROM schema_migrations; INSERT INTO schema_migrations VALUES ('007_schema.sql')`)
	})
	if err := s.Migrate(ctx, "../../../migrations"); err == nil || !strings.Contains(err.Error(), "contiguous prefix") {
		t.Fatalf("gapped history accepted: %v", err)
	}
	var count int
	if err := s.Pool.QueryRow(ctx, "SELECT count(*) FROM schema_migrations").Scan(&count); err != nil || count != 2 {
		t.Fatalf("gapped ledger changed: %d %v", count, err)
	}
}
