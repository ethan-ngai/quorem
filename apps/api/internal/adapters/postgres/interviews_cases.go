package postgres

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/ethan-ngai/quorem/internal/execution"
	"github.com/jackc/pgx/v5"
)

func interviewPrivateCases(f problems.Fixture, level int) []interviews.CaseDetail {
	out := []interviews.CaseDetail{}
	if f.Problem.Odyssey == nil {
		for i, c := range f.HiddenCases {
			out = append(out, interviews.CaseDetail{ID: fmt.Sprintf("hidden:%d", i), Case: c})
		}
		return out
	}
	for l, cases := range f.OdysseyHiddenCases {
		if l >= level {
			break
		}
		for i, c := range cases {
			out = append(out, interviews.CaseDetail{ID: fmt.Sprintf("level:%d:case:%d", l+1, i), Case: c})
		}
	}
	return out
}
func interviewReveals(ctx context.Context, tx pgx.Tx, id, questionEpoch string) (map[string]bool, error) {
	rows, err := tx.Query(ctx, `SELECT case_id FROM interview_case_visibility WHERE session_id=$1 AND question_epoch=$2`, id, questionEpoch)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	reveals := map[string]bool{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			return nil, err
		}
		reveals[id] = true
	}
	return reveals, rows.Err()
}
func interviewCaseProjection(ctx context.Context, tx pgx.Tx, v interviewRecord, out *interviews.Snapshot) error {
	level := 1
	if v.fixture.Problem.Odyssey != nil {
		level = len(v.fixture.Problem.Odyssey.Levels)
	}
	reveals, err := interviewReveals(ctx, tx, v.snapshot.ID, v.snapshot.QuestionEpoch)
	if err != nil {
		return err
	}
	for _, c := range interviewPrivateCases(v.fixture, level) {
		c.Revealed = reveals[c.ID]
		if out.Role == "interviewer" {
			out.Question.PrivateCaseDetails = append(out.Question.PrivateCaseDetails, c)
		}
		if c.Revealed {
			out.Question.RevealedCases = append(out.Question.RevealedCases, c)
		}
	}
	return nil
}
func (s *Store) projectInterviewResults(ctx context.Context, tx pgx.Tx, v interviewRecord, submissionID string, out *judging.Submission) error {
	if out.Kind != "submit" {
		return nil
	}
	var fixture, raw []byte
	var epoch string
	var level int
	if err := tx.QueryRow(ctx, `SELECT fixture,private_results,question_epoch,level FROM interview_execution WHERE submission_id=$1 AND session_id=$2`, submissionID, v.snapshot.ID).Scan(&fixture, &raw, &epoch, &level); err != nil {
		return err
	}
	if v.snapshot.Role != "interviewer" && epoch != v.snapshot.QuestionEpoch {
		return nil
	}
	var f problems.Fixture
	if err := json.Unmarshal(fixture, &f); err != nil {
		return err
	}
	cases := interviewPrivateCases(f, level)
	publicFallback := len(cases) == 0 && f.Problem.Odyssey == nil
	if publicFallback {
		for i, c := range f.Problem.SampleCases() {
			cases = append(cases, interviews.CaseDetail{ID: fmt.Sprintf("example:%d", i), Case: c, Revealed: true})
		}
	}
	reveals, err := interviewReveals(ctx, tx, v.snapshot.ID, epoch)
	if err != nil {
		return err
	}
	results := []execution.PublicCaseResult{}
	if len(raw) > 0 {
		if err = json.Unmarshal(raw, &results); err != nil {
			return err
		}
	}
	if len(results) == 0 && (out.State != "completed" || len(out.HiddenCases) != len(cases)) {
		return nil
	}
	for i, c := range cases {
		if v.snapshot.Role != "interviewer" && !publicFallback && !reveals[c.ID] {
			continue
		}
		result := execution.PublicCaseResult{Index: i}
		if len(results) == 0 {
			result.Status = string(out.HiddenCases[i].Status)
		}
		if i < len(results) {
			result = results[i]
		}
		out.PrivateCaseResults = append(out.PrivateCaseResults, judging.InterviewCaseResult{CaseID: c.ID, Case: c.Case, PublicCaseResult: result})
	}
	return nil
}
