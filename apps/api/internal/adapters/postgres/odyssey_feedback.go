package postgres

import (
	"context"
	"encoding/json"
	"github.com/ethan-ngai/quorem/internal/execution"
)

// Latest evaluated statuses survive pending jobs; omitted/new cases never inherit a verdict.
func latestCaseStatuses(ctx context.Context, q querier, history string, args ...any) ([]execution.PublicCaseResult, error) {
	var raw []byte
	err := q.QueryRow(ctx, caseStatusesSQL(history), args...).Scan(&raw)
	if err != nil {
		return nil, err
	}
	return decodeCaseStatuses(raw)
}

func caseStatusesSQL(history string) string {
	return `SELECT COALESCE(jsonb_agg(jsonb_build_object('index',idx,'status',status) ORDER BY idx),'[]'::jsonb) FROM (
 SELECT DISTINCT ON ((c->>'index')::int) (c->>'index')::int AS idx,c->>'status' AS status
 FROM (` + history + `) h CROSS JOIN LATERAL jsonb_array_elements(h.cases) c
 WHERE c->>'status' IS NOT NULL
 ORDER BY (c->>'index')::int,h.admitted_at DESC,h.id DESC
 ) evaluated`
}

func decodeCaseStatuses(raw []byte) ([]execution.PublicCaseResult, error) {
	var results []execution.PublicCaseResult
	err := json.Unmarshal(raw, &results)
	return results, err
}
