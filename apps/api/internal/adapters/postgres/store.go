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
	"strconv"
	"time"
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

// OpenPool bounds each replica's connections; idle compute must not retain a minimum pool.
func OpenPool(ctx context.Context, url string) (*pgxpool.Pool, error) {
	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	max := 4
	if value := os.Getenv("QUOREM_DATABASE_MAX_CONNS"); value != "" {
		max, err = strconv.Atoi(value)
		if err != nil || max < 1 || max > 64 {
			return nil, fmt.Errorf("QUOREM_DATABASE_MAX_CONNS must be between 1 and 64")
		}
	}
	config.MaxConns = int32(max)
	config.MinConns = 0
	config.MinIdleConns = 0
	config.MaxConnIdleTime = 30 * time.Second
	if config.ConnConfig.ConnectTimeout == 0 {
		config.ConnConfig.ConnectTimeout = 5 * time.Second
	}
	p, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, err
	}
	boot, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err = p.Ping(boot); err != nil {
		p.Close()
		return nil, err
	}
	return p, nil
}

func Open(ctx context.Context, url string) (*Store, error) {
	p, err := OpenPool(ctx, url)
	if err != nil {
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
	archive, err := loadMigrationArchive(dir)
	if err != nil {
		return fmt.Errorf("migration archive: %w", err)
	}
	if !names[archive.Baseline] {
		return fmt.Errorf("migration archive baseline unavailable: %s", archive.Baseline)
	}
	if len(appliedNames) > 0 && !appliedNames[archive.Baseline] {
		known := make(map[string]bool, len(archive.Migrations))
		for _, entry := range archive.Migrations {
			known[entry.Name] = true
		}
		for name := range appliedNames {
			if !known[name] {
				return fmt.Errorf("database has unavailable migration %s; for a current preproduction database run python3 scripts/adopt-schema.py --service product (see docs/implementation/database.md)", name)
			}
		}
		missing := false
		for _, entry := range archive.Migrations {
			if appliedNames[entry.Name] {
				if missing {
					return fmt.Errorf("legacy migration history is not a contiguous prefix")
				}
				continue
			}
			missing = true
		}
		if !appliedNames[archive.Migrations[0].Name] {
			return fmt.Errorf("legacy migration baseline missing")
		}
		for _, entry := range archive.Migrations[1:] {
			if appliedNames[entry.Name] {
				continue
			}
			if _, e := tx.Exec(ctx, string(entry.SQL)); e != nil {
				return fmt.Errorf("legacy migration %s: %w", entry.Name, e)
			}
		}
		if _, err = tx.Exec(ctx, "DELETE FROM schema_migrations"); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "INSERT INTO schema_migrations(name) VALUES ($1)", archive.Baseline); err != nil {
			return err
		}
		appliedNames = map[string]bool{archive.Baseline: true}
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
