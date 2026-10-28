package postgres

import (
	"encoding/json"

	"github.com/ethan-ngai/quorem/apps/api/internal/judging"
	"github.com/ethan-ngai/quorem/internal/execution"
)

// SQL reads only statuses and scores; opaque bytes retain arbitrary contestant output.
func resultStatuses(results []execution.PublicCaseResult) []execution.PublicCaseResult {
	if results == nil {
		return nil
	}
	statuses := make([]execution.PublicCaseResult, len(results))
	for i, result := range results {
		statuses[i] = execution.PublicCaseResult{Index: result.Index, Status: result.Status}
	}
	return statuses
}

func encodePublicResults(results []execution.PublicCaseResult, lossless bool) ([]byte, []byte, error) {
	raw, err := json.Marshal(results)
	if err != nil {
		return nil, nil, err
	}
	if !lossless {
		return raw, nil, nil
	}
	summary, err := json.Marshal(resultStatuses(results))
	return summary, raw, err
}

func encodeSubmissionResult(result judging.Submission, lossless bool) ([]byte, []byte, error) {
	raw, err := json.Marshal(result)
	if err != nil {
		return nil, nil, err
	}
	if !lossless {
		return raw, nil, nil
	}
	result.PublicCases = resultStatuses(result.PublicCases)
	result.Diagnostics = nil
	summary, err := json.Marshal(result)
	return summary, raw, err
}
