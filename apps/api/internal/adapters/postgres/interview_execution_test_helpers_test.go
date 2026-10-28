package postgres

import (
	"context"

	"github.com/ethan-ngai/quorem/apps/api/internal/interviews"
	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
)

func admitInterviewForTest(s *Store, ctx context.Context, user, id, key, kind string, cases []problems.Case) (judging.Submission, error) {
	var source, epoch, documentEpoch string
	if err := s.Pool.QueryRow(ctx, `SELECT source,question_epoch,document_epoch FROM interviews WHERE id=$1`, id).Scan(&source, &epoch, &documentEpoch); err != nil {
		return judging.Submission{}, err
	}
	level := 1
	if err := s.Pool.QueryRow(ctx, `SELECT COALESCE((SELECT level FROM odyssey_progress WHERE scope_id=$1 LIMIT 1),1)`, epoch).Scan(&level); err != nil {
		return judging.Submission{}, err
	}
	return s.AdmitInterview(ctx, user, id, key, interviews.ExecutionCommand{Level: level, Kind: kind, CustomCases: cases, QuestionEpoch: epoch, DocumentEpoch: documentEpoch, SourceHash: Hash([]byte(source))})
}
