package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/ethan-ngai/quorem/apps/api/internal/application"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"path/filepath"
	"sort"
)

type Store struct {
	Pool      *pgxpool.Pool
	inviteKey []byte
}

// Compatibility aliases keep adapter callers source-compatible during migration.
type Error = application.Error

func failure(code string, status int, message string) error {
	return &application.Error{Code: code, Status: status, Message: message}
}
func ID() string { return application.ID() }
func Open(ctx context.Context, url string) (*Store, error) {
	p, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, err
	}
	if err = p.Ping(ctx); err != nil {
		p.Close()
		return nil, err
	}
	key, err := loadInviteKey()
	if err != nil {
		p.Close()
		return nil, err
	}
	return &Store{Pool: p, inviteKey: key}, nil
}
func (s *Store) Migrate(ctx context.Context, dir string) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(740010)"); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY)"); err != nil {
		return err
	}
	paths, err := filepath.Glob(filepath.Join(dir, "*.sql"))
	if err != nil {
		return err
	}
	sort.Strings(paths)
	if len(paths) == 0 {
		return fmt.Errorf("no SQL migrations found in %s", dir)
	}
	rows, err := tx.Query(ctx, "SELECT name FROM schema_migrations")
	if err != nil {
		return err
	}
	appliedNames := make(map[string]bool)
	for rows.Next() {
		var name string
		if err = rows.Scan(&name); err != nil {
			rows.Close()
			return err
		}
		appliedNames[name] = true
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return err
	}
	names := make(map[string]bool, len(paths))
	for _, path := range paths {
		names[filepath.Base(path)] = true
	}
	for name := range appliedNames {
		if !names[name] {
			return fmt.Errorf("database has unavailable migration %s; for a current preproduction database run python3 scripts/adopt-schema.py --service product (see docs/implementation/database.md)", name)
		}
	}
	for _, path := range paths {
		if appliedNames[filepath.Base(path)] {
			continue
		}
		data, e := os.ReadFile(path)
		if e != nil {
			return e
		}
		if _, e = tx.Exec(ctx, string(data)); e != nil {
			return fmt.Errorf("migration %s: %w", path, e)
		}
		if _, e = tx.Exec(ctx, "INSERT INTO schema_migrations(name) VALUES($1)", filepath.Base(path)); e != nil {
			return e
		}
	}
	return tx.Commit(ctx)
}
func (s *Store) Seed(ctx context.Context, fixtures []problems.Fixture) error {
	// Fixture identities belong to explicit local seeding, never schema creation.
	if _, err := s.Pool.Exec(ctx, `INSERT INTO users(id,display_name,participant_id) VALUES
 ('alice','Alice','00000000-0000-4000-8000-000000000001'),
 ('bob','Bob','00000000-0000-4000-8000-000000000002'),
 ('charlie','Charlie','00000000-0000-4000-8000-000000000003'),
 ('dana','Dana','00000000-0000-4000-8000-000000000004') ON CONFLICT(id) DO NOTHING`); err != nil {
		return err
	}

	return s.SeedProblems(ctx, fixtures)
}

// SeedProblems installs append-only catalog content without development identities.
func (s *Store) SeedProblems(ctx context.Context, fixtures []problems.Fixture) error {
	for _, f := range fixtures {
		public, _ := json.Marshal(f.Problem)
		private, _ := json.Marshal(f)
		_, err := s.Pool.Exec(ctx, "INSERT INTO problem_versions(id,slug,version,public,fixture) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING", f.Problem.ID, f.Problem.Slug, f.Problem.Version, public, private)
		if err != nil {
			return err
		}
		implementations, references, err := problems.Implementations(f)
		if err != nil {
			return err
		}
		if err = s.RegisterImplementations(ctx, f.Problem.ID, implementations, references); err != nil {
			return err
		}
	}
	return nil
}
