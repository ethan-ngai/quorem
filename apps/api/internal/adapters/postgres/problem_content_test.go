package postgres

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestNormalizedProblemContentAndEditorialIsolation(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	p, err := s.Problem(ctx, "run-widths", false)
	if err != nil || len(p.Languages) < 1 {
		t.Fatal(p, err)
	}
	payload, _ := json.Marshal(p)
	if strings.Contains(string(payload), "referenceSource") || strings.Contains(string(payload), "hiddenCases") {
		t.Fatal("private data in public projection")
	}
	empty, err := s.Solutions(ctx, p.ID)
	if err != nil || len(empty) != 0 {
		t.Fatal("reference exposed as editorial", empty, err)
	}
	authored := problems.EditorialSolution{Language: "python", Source: "editorial-only-marker", ExplanationMarkdown: "Group runs.", TimeComplexity: "O(n)", SpaceComplexity: "O(n)", ComplexityNotes: "n is input length; includes output."}
	if err = s.SaveSolutions(ctx, p.ID, []problems.EditorialSolution{authored}); err != nil {
		t.Fatal(err)
	}
	got, err := s.Solutions(ctx, p.ID)
	if err != nil || len(got) != 1 || got[0] != authored {
		t.Fatal(got, err)
	}
	if errorCode(s.SaveSolutions(ctx, p.ID, nil)) != "immutable_version" {
		t.Fatal("editorial overwritten")
	}
	if _, err = s.Pool.Exec(ctx, "UPDATE problem_versions SET title='changed' WHERE id=$1", p.ID); err == nil {
		t.Fatal("published version mutated")
	}
	var v problems.LanguageImplementation
	for _, language := range p.Languages {
		if language.Language == "python" {
			v = language
		}
	}
	if v.Language != "python" {
		t.Fatal("missing Python implementation")
	}
	if err = s.RegisterImplementations(ctx, p.ID, []problems.LanguageImplementation{v}, map[string]string{"python": "changed-reference"}); errorCode(err) != "immutable_version" {
		t.Fatal("language changed", err)
	}
	if _, err = s.Pool.Exec(ctx, "INSERT INTO problems(slug,current_version_id) VALUES('wrong-parent',$1)", p.ID); err == nil {
		t.Fatal("cross-problem publication accepted")
	}
}

func TestNormalizedMigrationBackfillsExistingVersions(t *testing.T) {
	url := os.Getenv("QUOREM_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("disposable PostgreSQL required")
	}
	ctx := context.Background()
	base, err := Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer base.Pool.Close()
	schema := "upgrade_" + strings.ReplaceAll(ID(), "-", "")
	if _, err = base.Pool.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer base.Pool.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	s := &Store{Pool: pool, inviteKey: base.inviteKey}
	legacy := t.TempDir()
	paths, _ := filepath.Glob("../../../migrations/*.sql")
	for _, path := range paths {
		if filepath.Base(path) >= "071" {
			continue
		}
		data, e := os.ReadFile(path)
		if e != nil {
			t.Fatal(e)
		}
		if e = os.WriteFile(filepath.Join(legacy, filepath.Base(path)), data, 0600); e != nil {
			t.Fatal(e)
		}
	}
	if err = s.Migrate(ctx, legacy); err != nil {
		t.Fatal(err)
	}
	fixtures, err := problems.LoadFixtures("../../../../../fixtures/problems")
	if err != nil {
		t.Fatal(err)
	}
	for _, fixture := range fixtures {
		public, _ := json.Marshal(fixture.Problem)
		private, _ := json.Marshal(fixture)
		if _, err = pool.Exec(ctx, "INSERT INTO problem_versions(id,slug,version,public,fixture) VALUES($1,$2,$3,$4,$5)", fixture.Problem.ID, fixture.Problem.Slug, fixture.Problem.Version, public, private); err != nil {
			t.Fatal(err)
		}
	}
	first := fixtures[0]
	var workspaceID string
	err = pool.QueryRow(ctx, "INSERT INTO workspaces(id,owner_id,problem_version_id,language,kind) VALUES($1,'alice',$2,'python','solo') RETURNING id::text", ID(), first.Problem.ID).Scan(&workspaceID)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Migrate(ctx, "../../../migrations"); err != nil {
		t.Fatal(err)
	}
	p, err := s.Problem(ctx, first.Problem.ID, true)
	if err != nil || p.ID != first.Problem.ID || p.Title != first.Problem.Title || len(p.Languages) != 1 {
		t.Fatal(p, err)
	}
	w, err := s.Workspace(ctx, "alice", workspaceID)
	if err != nil || w.ProblemVersionID != p.ID {
		t.Fatal("workspace identity lost", w, err)
	}
	var n int
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM problem_test_cases WHERE version_id=$1", p.ID).Scan(&n); err != nil || n != 20 {
		t.Fatal(n, err)
	}
	if err = s.Migrate(ctx, "../../../migrations"); err != nil {
		t.Fatal("migration retry", err)
	}
}
