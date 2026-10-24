package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/jackc/pgx/v5"
)

// Aggregate only public records; judge references and hidden cases cannot enter this projection.
const publicProblemSQL = `SELECT jsonb_build_object(
 'id',v.id,'slug',p.slug,'version',v.version::text,'title',v.title,'difficulty',v.difficulty,
 'odyssey',CASE WHEN v.public->'odyssey' IS NOT NULL THEN jsonb_build_object('levels',jsonb_build_array(v.public->'odyssey'->'levels'->0)) ELSE NULL END,
 'statementMarkdown',v.statement_markdown,'signature',v.signature,'constraints',v.constraints,'limits',v.limits,
 'tags',COALESCE((SELECT jsonb_agg(tag ORDER BY ordinal) FROM problem_tags WHERE version_id=v.id),'[]'),
 'examples',COALESCE((SELECT jsonb_agg(jsonb_build_object('args',args,'expected',expected,'explanation',explanation) ORDER BY ordinal) FROM problem_examples WHERE version_id=v.id),'[]'),
 'languages',COALESCE((SELECT jsonb_agg(jsonb_build_object('language',language,'starterSource',starter_source,'runtimeRevision',runtime_revision,'harnessRevision',harness_revision) ORDER BY language) FROM problem_languages WHERE version_id=v.id),'[]'),
 'starterSource',py.starter_source,'runtimeRevision',py.runtime_revision)
 FROM problem_versions v JOIN problems p ON p.id=v.problem_id
 JOIN problem_languages py ON py.version_id=v.id AND py.language='python' `

func (s *Store) Problem(ctx context.Context, value string, byID bool) (problems.Problem, error) {
	query := publicProblemSQL + " WHERE p.slug=$1 AND v.id=p.current_version_id"
	if byID {
		query = publicProblemSQL + " WHERE v.id::text=$1"
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
	rows, err := s.Pool.Query(ctx, publicProblemSQL+" WHERE v.id=p.current_version_id ORDER BY p.slug")
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

func (s *Store) Solutions(ctx context.Context, versionID string) ([]problems.EditorialSolution, error) {
	var odyssey bool
	if err := s.Pool.QueryRow(ctx, "SELECT COALESCE(public->'odyssey' IS NOT NULL,false) FROM problem_versions WHERE id::text=$1", versionID).Scan(&odyssey); err == nil && odyssey {
		return []problems.EditorialSolution{}, nil
	}
	return s.readSolutions(ctx, versionID)
}
func (s *Store) readSolutions(ctx context.Context, versionID string) ([]problems.EditorialSolution, error) {
	if _, err := s.Problem(ctx, versionID, true); err != nil {
		return nil, err
	}
	rows, err := s.Pool.Query(ctx, `SELECT language,source,explanation_markdown,time_complexity,space_complexity,complexity_notes FROM problem_solutions WHERE version_id::text=$1 ORDER BY language`, versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []problems.EditorialSolution{}
	for rows.Next() {
		var v problems.EditorialSolution
		if err = rows.Scan(&v.Language, &v.Source, &v.ExplanationMarkdown, &v.TimeComplexity, &v.SpaceComplexity, &v.ComplexityNotes); err != nil {
			return nil, err
		}
		result = append(result, v)
	}
	return result, rows.Err()
}

// Append authored editorials once; later changes require a new version.
func (s *Store) SaveSolutions(ctx context.Context, versionID string, solutions []problems.EditorialSolution) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var exists string
	if err = tx.QueryRow(ctx, "SELECT id::text FROM problem_versions WHERE id::text=$1 FOR UPDATE", versionID).Scan(&exists); errors.Is(err, pgx.ErrNoRows) {
		return failure("not_found", 404, "Problem not found")
	} else if err != nil {
		return err
	}
	var authored bool
	if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM problem_solutions WHERE version_id::text=$1)", versionID).Scan(&authored); err != nil {
		return err
	}
	if authored {
		return failure("immutable_version", 409, "Publish a new version to change editorial content")
	}
	for _, v := range solutions {
		if v.Source == "" || v.ExplanationMarkdown == "" || v.TimeComplexity == "" || v.SpaceComplexity == "" {
			return failure("invalid_solution", 400, "Solution code, explanation and complexity required")
		}
		if _, err = tx.Exec(ctx, `INSERT INTO problem_solutions VALUES($1,$2,$3,$4,$5,$6,$7)`, versionID, v.Language, v.Source, v.ExplanationMarkdown, v.TimeComplexity, v.SpaceComplexity, v.ComplexityNotes); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// Registration is idempotent, but published language artifacts cannot change in place.
func (s *Store) RegisterImplementations(ctx context.Context, versionID string, implementations []problems.LanguageImplementation, references map[string]string) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	for _, v := range implementations {
		reference, ok := references[v.Language]
		if !ok || reference == "" || v.StarterSource == "" || v.RuntimeRevision == "" || v.HarnessRevision == "" {
			return failure("invalid_implementation", 400, "Complete language implementation required")
		}
		tag, e := tx.Exec(ctx, `INSERT INTO problem_languages VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(version_id,language) DO UPDATE SET language=EXCLUDED.language WHERE problem_languages.starter_source=EXCLUDED.starter_source AND problem_languages.runtime_revision=EXCLUDED.runtime_revision AND problem_languages.harness_revision=EXCLUDED.harness_revision AND problem_languages.reference_source=EXCLUDED.reference_source`, versionID, v.Language, v.StarterSource, v.RuntimeRevision, v.HarnessRevision, reference)
		if e != nil {
			return e
		}
		if tag.RowsAffected() != 1 {
			return failure("immutable_version", 409, "Publish a new version to change language artifacts")
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) HasActiveMatchProblem(ctx context.Context, owner, versionID string) (bool, error) {
	var active bool
	err := s.Pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM match_participants p JOIN matches m ON m.id=p.match_id WHERE p.owner_id=$1 AND m.problem_version_id::text=$2 AND m.state IN ('active','finalizing'))`, owner, versionID).Scan(&active)
	return active, err
}
