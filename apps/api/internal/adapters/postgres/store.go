package postgres

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"os"
	"path/filepath"
	"sort"
)

type Store struct{ Pool *pgxpool.Pool }
type Error struct {
	Code    string
	Message string
	Status  int
}

func (e *Error) Error() string                              { return e.Message }
func failure(code string, status int, message string) error { return &Error{code, message, status} }
func ID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	b[6] = b[6]&15 | 64
	b[8] = b[8]&63 | 128
	s := hex.EncodeToString(b)
	return s[:8] + "-" + s[8:12] + "-" + s[12:16] + "-" + s[16:20] + "-" + s[20:]
}
func Open(ctx context.Context, url string) (*Store, error) {
	p, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, err
	}
	if err = p.Ping(ctx); err != nil {
		p.Close()
		return nil, err
	}
	return &Store{p}, nil
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
	for _, path := range paths {
		var applied bool
		if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE name=$1)", filepath.Base(path)).Scan(&applied); err != nil {
			return err
		}
		if applied {
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
	for _, f := range fixtures {
		public, _ := json.Marshal(f.Problem)
		private, _ := json.Marshal(f)
		_, err := s.Pool.Exec(ctx, "INSERT INTO problem_versions(id,slug,version,public,fixture) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING", f.Problem.ID, f.Problem.Slug, f.Problem.Version, public, private)
		if err != nil {
			return err
		}
	}
	return nil
}
func (s *Store) Problem(ctx context.Context, value string, byID bool) (problems.Problem, error) {
	query := "SELECT public FROM problem_versions WHERE slug=$1 ORDER BY version DESC LIMIT 1"
	if byID {
		query = "SELECT public FROM problem_versions WHERE id::text=$1"
	}
	var data []byte
	err := s.Pool.QueryRow(ctx, query, value).Scan(&data)
	if errors.Is(err, pgx.ErrNoRows) {
		return problems.Problem{}, failure("not_found", 404, "Problem not found")
	}
	var p problems.Problem
	if err == nil {
		err = json.Unmarshal(data, &p)
	}
	return p, err
}
func (s *Store) Problems(ctx context.Context) ([]problems.Problem, error) {
	rows, err := s.Pool.Query(ctx, "SELECT public FROM problem_versions ORDER BY slug")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []problems.Problem{}
	for rows.Next() {
		var data []byte
		if err = rows.Scan(&data); err != nil {
			return nil, err
		}
		var p problems.Problem
		if err = json.Unmarshal(data, &p); err != nil {
			return nil, err
		}
		result = append(result, p)
	}
	return result, rows.Err()
}
