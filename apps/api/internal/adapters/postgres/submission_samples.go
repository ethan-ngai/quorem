package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/ethan-ngai/quorem/internal/execution"
	"github.com/jackc/pgx/v5"
)

// Sample output uses its own completion field; hidden result details never enter public storage.
func validateSubmitSamples(ctx context.Context, tx pgx.Tx, j execution.Job, results []execution.PublicCaseResult) error {
	var raw []byte
	var level *int
	if err := tx.QueryRow(ctx, `SELECT COALESCE(q.fixture->'problem',jsonb_build_object('examples',`+problemExamplesSQL+`,'odyssey',v.odyssey)),`+admittedOdysseyLevelSQL+` FROM submissions s LEFT JOIN workspaces w ON w.id=s.workspace_id LEFT JOIN problem_versions v ON v.id=w.problem_version_id LEFT JOIN interview_execution ie ON ie.submission_id=s.id LEFT JOIN interview_question_snapshots q ON q.session_id=ie.session_id AND q.id=ie.fixture_id WHERE s.id=$1`, j.SubmissionID).Scan(&raw, &level); err != nil {
		return err
	}
	var p problems.Problem
	if err := json.Unmarshal(raw, &p); err != nil {
		return err
	}
	if err := limitAdmittedOdyssey(&p, level); err != nil {
		return err
	}
	samples := p.SampleCases()
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
