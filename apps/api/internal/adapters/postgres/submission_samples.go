package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/ethan-ngai/quorem/internal/execution"
	"github.com/jackc/pgx/v5"
)

func submissionSamples(p problems.Problem) []problems.Case {
	if p.Odyssey == nil {
		return p.SampleCases()
	}
	cases := []problems.Case{}
	for _, level := range p.Odyssey.Levels {
		for _, example := range level.Examples {
			cases = append(cases, example.Case)
		}
	}
	return cases
}

// Sample output uses its own completion field; hidden result details never enter public storage.
func validateSubmitSamples(ctx context.Context, tx pgx.Tx, j execution.Job, results []execution.PublicCaseResult) error {
	var raw []byte
	var level *int
	if err := tx.QueryRow(ctx, `SELECT COALESCE(ie.fixture->'problem',p.public),s.odyssey_level FROM submissions s JOIN workspaces w ON w.id=s.workspace_id JOIN problem_versions p ON p.id=w.problem_version_id LEFT JOIN interview_execution ie ON ie.submission_id=s.id WHERE s.id=$1`, j.SubmissionID).Scan(&raw, &level); err != nil {
		return err
	}
	var p problems.Problem
	if err := json.Unmarshal(raw, &p); err != nil {
		return err
	}
	if p.Odyssey != nil && level != nil {
		if *level < 1 || *level > len(p.Odyssey.Levels) {
			return errors.New("invalid admitted sample level")
		}
		p.Odyssey = &problems.Odyssey{Levels: p.Odyssey.Levels[:*level]}
	}
	samples := submissionSamples(p)
	if len(results) != len(samples) {
		return errors.New("incomplete submit samples")
	}
	for i, r := range results {
		if r.Index != i || len(r.Stdout) > j.Limits.OutputBytes || len(r.Stderr) > j.Limits.OutputBytes || len(r.Actual) > j.Limits.OutputBytes {
			return errors.New("invalid submit samples")
		}
	}
	return nil
}
