package postgres

import (
	"context"
	"encoding/json"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/jackc/pgx/v5"
)

type ProblemFilter = problems.ProblemFilter
type ProblemPage = problems.ProblemPage

// A stable snapshot keeps the page, count and unfiltered topic options consistent.
func (s *Store) ProblemCatalog(ctx context.Context, f ProblemFilter) (ProblemPage, error) {
	if f.Page < 1 || f.Page > 10000 || f.Limit < 1 || f.Limit > 100 {
		return ProblemPage{}, failure("invalid_input", 400, "Invalid question pagination")
	}
	result := ProblemPage{Items: []problems.Problem{}, Topics: []string{}, Page: f.Page, Limit: f.Limit}
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return result, err
	}
	defer tx.Rollback(ctx)
	where := ` WHERE v.id=p.current_version_id AND ($1='' OR strpos(lower(v.title||' '||p.slug),lower($1))>0 OR EXISTS(SELECT 1 FROM problem_tags t WHERE t.version_id=v.id AND strpos(lower(t.tag),lower($1))>0)) AND ($2='' OR v.difficulty=ANY(string_to_array($2,','))) AND ($3='' OR EXISTS(SELECT 1 FROM problem_tags t WHERE t.version_id=v.id AND t.tag=ANY(string_to_array($3,','))))`
	args := []any{f.Query, f.Difficulty, f.Topic}
	err = tx.QueryRow(ctx, `SELECT count(*) FROM problem_versions v JOIN problems p ON p.id=v.problem_id`+where, args...).Scan(&result.Total)
	if err != nil {
		return result, err
	}
	// Sort fragments are fixed server values; all user text remains bound parameters.
	direction := " ASC"
	if f.Order == "desc" {
		direction = " DESC"
	}
	order := "lower(v.title)" + direction + ", p.slug" + direction
	if f.Sort == "difficulty" {
		order = "CASE v.difficulty WHEN 'easy' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END" + direction + ", " + order
	}
	rows, err := tx.Query(ctx, publicProblemSQL+where+" ORDER BY "+order+" LIMIT $4 OFFSET $5", append(args, f.Limit, (f.Page-1)*f.Limit)...)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var data []byte
		var item problems.Problem
		if err = rows.Scan(&data); err != nil {
			rows.Close()
			return result, err
		}
		if err = json.Unmarshal(data, &item); err != nil {
			rows.Close()
			return result, err
		}
		result.Items = append(result.Items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return result, err
	}
	rows, err = tx.Query(ctx, `SELECT DISTINCT t.tag FROM problem_tags t JOIN problems p ON p.current_version_id=t.version_id ORDER BY t.tag`)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var tag string
		if err = rows.Scan(&tag); err != nil {
			rows.Close()
			return result, err
		}
		result.Topics = append(result.Topics, tag)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return result, err
	}
	return result, tx.Commit(ctx)
}
