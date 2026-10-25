package postgres

import (
	"context"
	"encoding/json"
	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"strings"
	"testing"
)

func TestComplexityAvailabilityFollowsPublishedRecords(t *testing.T) {
	s := interviewTestStore(t)
	ctx := context.Background()
	if err := s.SeedEditorials(ctx, "../../../../../fixtures/editorials"); err != nil {
		t.Fatal(err)
	}
	p, err := s.Problem(ctx, "run-widths", false)
	if err != nil || len(p.ComplexityLanguages) == 0 {
		t.Fatalf("catalog omitted published availability: %+v %v", p.ComplexityLanguages, err)
	}
	data, _ := json.Marshal(p)
	for _, field := range []string{"timeComplexity", "spaceComplexity", "complexityNotes", "\"source\""} {
		if strings.Contains(string(data), field) {
			t.Fatalf("availability leaked editorial field %s", field)
		}
	}
	v, err := s.CreateInterview(ctx, "alice", ID(), interviews.Create{Title: "Published costs", Question: interviews.QuestionInput{ProblemVersionID: p.ID, Language: "python"}})
	if err != nil || len(v.Question.Problem.ComplexityLanguages) == 0 {
		t.Fatalf("interview omitted published availability: %v", err)
	}
	if _, err = s.Pool.Exec(ctx, "DELETE FROM problem_solutions WHERE version_id=$1", p.ID); err != nil {
		t.Fatal(err)
	}
	p, err = s.Problem(ctx, "run-widths", false)
	if err != nil || len(p.ComplexityLanguages) != 0 {
		t.Fatalf("catalog invented complexity: %v", err)
	}
	v, err = s.Interview(ctx, "alice", v.ID)
	if err != nil || len(v.Question.Problem.ComplexityLanguages) != 0 {
		t.Fatalf("interview retained stale availability: %v", err)
	}
	v, err = s.UpdateInterviewQuestion(ctx, "alice", v.ID, ID(), customInterviewQuestion())
	if err != nil || len(v.Question.Problem.ComplexityLanguages) != 0 {
		t.Fatalf("custom question invented complexity: %v", err)
	}
}
