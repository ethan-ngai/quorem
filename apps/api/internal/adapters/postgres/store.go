package postgres

import (
	"context"
	"crypto/sha256"
	"fmt"
	"github.com/ethan-ngai/quorem/apps/api/internal/application"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"time"
	"unicode/utf8"
)

type Store struct {
	Pool            *pgxpool.Pool
	inviteKey       []byte
	losslessResults bool
}

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
	return &Store{Pool: p, inviteKey: key, losslessResults: os.Getenv("QUOREM_LOSSLESS_RESULT_WRITES") == "true"}, nil
}
func (s *Store) Migrate(ctx context.Context, dir string) error {
	paths, err := filepath.Glob(filepath.Join(dir, "*.sql"))
	if err != nil {
		return err
	}
	sort.Strings(paths)
	if len(paths) == 0 {
		return fmt.Errorf("no SQL migrations found in %s", dir)
	}
	type migration struct{ name, sql, checksum string }
	files := make([]migration, 0, len(paths))
	for _, path := range paths {
		data, e := os.ReadFile(path)
		if e != nil {
			return e
		}
		if !utf8.Valid(data) {
			return fmt.Errorf("migration %s is not UTF-8", path)
		}
		files = append(files, migration{filepath.Base(path), string(data), fmt.Sprintf("%x", sha256.Sum256(data))})
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(740010)"); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "CREATE TABLE IF NOT EXISTS public.schema_migrations(name text PRIMARY KEY)"); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "ALTER TABLE public.schema_migrations ADD COLUMN IF NOT EXISTS checksum text, ADD COLUMN IF NOT EXISTS baseline_operation text, ADD COLUMN IF NOT EXISTS baseline_operator text, ADD COLUMN IF NOT EXISTS baseline_reason text, ADD COLUMN IF NOT EXISTS baseline_artifact text"); err != nil {
		return err
	}
	rows, err := tx.Query(ctx, "SELECT name,checksum FROM public.schema_migrations FOR UPDATE")
	if err != nil {
		return err
	}
	appliedNames := make(map[string]*string)
	for rows.Next() {
		var name string
		var checksum *string
		if err = rows.Scan(&name, &checksum); err != nil {
			rows.Close()
			return err
		}
		appliedNames[name] = checksum
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return err
	}
	names := make(map[string]bool, len(files))
	for _, file := range files {
		names[file.name] = true
	}
	for name := range appliedNames {
		if !names[name] {
			return fmt.Errorf("database has unavailable migration %s", name)
		}
	}
	missing := false
	for _, file := range files {
		if _, ok := appliedNames[file.name]; !ok {
			missing = true
		} else if missing {
			return fmt.Errorf("migration history is not a contiguous prefix")
		}
	}
	for _, file := range files {
		if checksum, ok := appliedNames[file.name]; ok {
			if checksum == nil || *checksum == "" {
				return fmt.Errorf("product migration history requires an audited baseline")
			}
			if *checksum != file.checksum {
				return fmt.Errorf("product migration checksum mismatch: %s", file.name)
			}
		}
	}
	for _, file := range files {
		if _, ok := appliedNames[file.name]; ok {
			continue
		}
		if _, e := tx.Exec(ctx, file.sql); e != nil {
			return fmt.Errorf("migration %s: %w", file.name, e)
		}
		if _, e := tx.Exec(ctx, "INSERT INTO public.schema_migrations(name,checksum) VALUES($1,$2)", file.name, file.checksum); e != nil {
			return e
		}
	}
	return tx.Commit(ctx)
}
func (s *Store) Seed(ctx context.Context, fixtures []problems.SeedFixture) error {
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
func (s *Store) SeedProblems(ctx context.Context, fixtures []problems.SeedFixture) error {
	for _, f := range fixtures {
		tx, err := s.Pool.Begin(ctx)
		if err != nil {
			return err
		}
		_, err = insertProblemVersion(ctx, tx, f.Fixture)
		if err != nil {
			_ = tx.Rollback(ctx)
			return err
		}
		if err = tx.Commit(ctx); err != nil {
			return err
		}
		implementations := make([]problems.LanguageImplementation, 0, len(f.Implementations))
		references := make(map[string]string, len(f.Implementations))
		for _, impl := range f.Implementations {
			implementations = append(implementations, impl.LanguageImplementation)
			references[impl.Language] = impl.ReferenceSource
		}
		if err = s.RegisterImplementations(ctx, f.Problem.ID, implementations, references); err != nil {
			return err
		}
	}
	return nil
}
