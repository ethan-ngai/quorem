package postgres

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestMigrationArchiveRejectsMissingAndModifiedFiles(t *testing.T) {
	source := "../../../migrations/legacy"
	for _, change := range []string{"remove", "modify", "extra"} {
		t.Run(change, func(t *testing.T) {
			dir := t.TempDir()
			root := filepath.Join(dir, "legacy")
			if err := os.Mkdir(root, 0700); err != nil {
				t.Fatal(err)
			}
			files, err := os.ReadDir(source)
			if err != nil {
				t.Fatal(err)
			}
			var firstSQL string
			for _, f := range files {
				data, err := os.ReadFile(filepath.Join(source, f.Name()))
				if err != nil {
					t.Fatal(err)
				}
				if err = os.WriteFile(filepath.Join(root, f.Name()), data, 0600); err != nil {
					t.Fatal(err)
				}
				if firstSQL == "" && strings.HasSuffix(f.Name(), ".sql") {
					firstSQL = filepath.Join(root, f.Name())
				}
			}
			switch change {
			case "remove":
				err = os.Remove(firstSQL)
			case "modify":
				err = os.WriteFile(firstSQL, []byte("changed"), 0600)
			case "extra":
				err = os.WriteFile(filepath.Join(root, "extra.sql"), nil, 0600)
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err = loadMigrationArchive(dir); err == nil {
				t.Fatal("invalid archive accepted")
			}
		})
	}
}

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

func TestFlattenedMigrationUpgradesLegacyPrefixes(t *testing.T) {
	base := testStore(t)
	ctx := context.Background()
	dir := "../../../migrations"
	archive, err := loadMigrationArchive(dir)
	if err != nil {
		t.Fatal(err)
	}
	legacy := archive.Migrations
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
			for _, entry := range legacy[:count] {
				if _, err = pool.Exec(ctx, string(entry.SQL)); err != nil {
					t.Fatal(entry.Name, err)
				}
			}
			if _, err = pool.Exec(ctx, `CREATE TABLE schema_migrations(name text PRIMARY KEY); INSERT INTO users(id,display_name) VALUES('upgrade-user','Preserved')`); err != nil {
				t.Fatal(err)
			}
			for _, entry := range legacy[:count] {
				if _, err = pool.Exec(ctx, "INSERT INTO schema_migrations VALUES($1)", entry.Name); err != nil {
					t.Fatal(err)
				}
			}
			_, grantErr := pool.Exec(ctx, `INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES(gen_random_uuid(),'upgrade-user','problems.odyssey','manual','old','test','test')`)
			var pgErr *pgconn.PgError
			if grantErr != nil && (!errors.As(grantErr, &pgErr) || pgErr.Code != "23514") {
				t.Fatal(grantErr)
			}
			if grantErr == nil {
				if _, err = pool.Exec(ctx, `INSERT INTO access_audit(operation_id,actor,user_id,action,scope,reason) VALUES ('old-odyssey','test','upgrade-user','grant:problems.odyssey','hash','test')`); err != nil {
					t.Fatal(err)
				}
			}
			if _, err = pool.Exec(ctx, `INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES(gen_random_uuid(),'upgrade-user','interviews.host','manual','keep','test','test'); INSERT INTO access_audit(operation_id,actor,user_id,action,scope,reason) VALUES ('keep-interview','test','upgrade-user','grant:interviews.host','hash','test')`); err != nil {
				t.Fatal(err)
			}
			s := &Store{Pool: pool}
			if err = s.Migrate(ctx, dir); err != nil {
				t.Fatal(err)
			}
			if err = s.Migrate(ctx, dir); err != nil {
				t.Fatal(err)
			}
			var users, grants, ledger int
			if err = pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM users WHERE id='upgrade-user'), (SELECT count(*) FROM entitlement_grants WHERE feature='problems.odyssey'), (SELECT count(*) FROM schema_migrations WHERE name=$1)`, archive.Baseline).Scan(&users, &grants, &ledger); err != nil || users != 1 || grants != 0 || ledger != 1 {
				t.Fatalf("upgrade state: %d %d %d %v", users, grants, ledger, err)
			}
			var oldAudit, keptAudit, keptGrant int
			var enabled string
			if err = pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM access_audit WHERE action='grant:problems.odyssey'), (SELECT count(*) FROM access_audit WHERE action='grant:interviews.host'), (SELECT count(*) FROM entitlement_grants WHERE feature='interviews.host'), (SELECT tgenabled::text FROM pg_trigger WHERE tgrelid='access_audit'::regclass AND tgname='immutable_access_audit')`).Scan(&oldAudit, &keptAudit, &keptGrant, &enabled); err != nil || oldAudit != 0 || keptAudit != 1 || keptGrant != 1 || enabled != "O" {
				t.Fatalf("upgrade preservation: %d %d %d %s %v", oldAudit, keptAudit, keptGrant, enabled, err)
			}
			_, err = pool.Exec(ctx, `INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES(gen_random_uuid(),'upgrade-user','problems.odyssey','manual','new','test','test')`)
			if !errors.As(err, &pgErr) || pgErr.Code != "23514" {
				t.Fatalf("obsolete grant accepted: %v", err)
			}
		})
	}
}

func TestFlattenedMigrationRejectsGappedHistory(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	archive, err := loadMigrationArchive("../../../migrations")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Pool.Exec(ctx, `DELETE FROM schema_migrations`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Pool.Exec(ctx, `INSERT INTO schema_migrations VALUES ($1),($2)`, archive.Migrations[0].Name, archive.Migrations[2].Name); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = s.Pool.Exec(ctx, `DELETE FROM schema_migrations`)
		_, _ = s.Pool.Exec(ctx, `INSERT INTO schema_migrations VALUES ($1)`, archive.Baseline)
	})
	if err := s.Migrate(ctx, "../../../migrations"); err == nil || !strings.Contains(err.Error(), "contiguous prefix") {
		t.Fatalf("gapped history accepted: %v", err)
	}
	var count int
	if err := s.Pool.QueryRow(ctx, "SELECT count(*) FROM schema_migrations").Scan(&count); err != nil || count != 2 {
		t.Fatalf("gapped ledger changed: %d %v", count, err)
	}
}
