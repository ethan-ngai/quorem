package postgres

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"strings"

	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
	"github.com/jackc/pgx/v5"
)

// JSONB cannot represent NUL; the sidecar is authoritative when present.
func caseStorageJSON(raw []byte, array bool) (safe, lossless []byte, err error) {
	var document any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err = decoder.Decode(&document); err != nil {
		return nil, nil, err
	}
	changed := false
	var clean func(any) any
	clean = func(value any) any {
		switch v := value.(type) {
		case string:
			if strings.ContainsRune(v, 0) {
				changed = true
				return strings.ReplaceAll(v, "\x00", "")
			}
			return v
		case []any:
			for i := range v {
				v[i] = clean(v[i])
			}
			return v
		case map[string]any:
			out := make(map[string]any, len(v))
			for k, x := range v {
				if strings.ContainsRune(k, 0) {
					changed = true
					k = strings.ReplaceAll(k, "\x00", "")
				}
				out[k] = clean(x)
			}
			return out
		default:
			return value
		}
	}
	cleanCases := func(value any) any { return clean(value) }
	if array {
		document = cleanCases(document)
	} else if root, ok := document.(map[string]any); ok {
		if x, ok := root["hiddenCases"]; ok {
			root["hiddenCases"] = cleanCases(x)
		}
		if x, ok := root["odysseyHiddenCases"]; ok {
			root["odysseyHiddenCases"] = cleanCases(x)
		}
		if problem, ok := root["problem"].(map[string]any); ok {
			if x, ok := problem["examples"]; ok {
				problem["examples"] = cleanCases(x)
			}
			if odyssey, ok := problem["odyssey"].(map[string]any); ok {
				if levels, ok := odyssey["levels"].([]any); ok {
					for _, stage := range levels {
						if item, ok := stage.(map[string]any); ok {
							if x, ok := item["examples"]; ok {
								item["examples"] = cleanCases(x)
							}
						}
					}
				}
			}
		}
	}
	if !changed {
		if containsNUL(document) {
			return nil, nil, failure("invalid_input", 400, "NUL is allowed only in coding case values")
		}
		return raw, nil, nil
	}
	if !losslessCasesEnabled() {
		return nil, nil, failure("invalid_input", 400, "NUL in case values is temporarily unavailable")
	}
	safe, err = json.Marshal(document)
	if err != nil {
		return nil, nil, err
	}
	// NUL outside case values has no supported PostgreSQL text representation.
	var remaining any
	if err = json.Unmarshal(safe, &remaining); err != nil {
		return nil, nil, err
	}
	if containsNUL(remaining) {
		return nil, nil, failure("invalid_input", 400, "NUL is allowed only in coding case values")
	}
	return safe, raw, nil
}

func containsNUL(value any) bool {
	switch v := value.(type) {
	case string:
		return strings.ContainsRune(v, 0)
	case []any:
		for _, x := range v {
			if containsNUL(x) {
				return true
			}
		}
	case map[string]any:
		for k, x := range v {
			if strings.ContainsRune(k, 0) || containsNUL(x) {
				return true
			}
		}
	}
	return false
}

func authoritativeJSON(projection, lossless []byte) []byte {
	if len(lossless) > 0 {
		return lossless
	}
	return projection
}

// Preserve the caller's stage visibility and metadata while restoring exact cases.
func restoreProblemCases(p *problems.Problem, raw []byte) error {
	if len(raw) == 0 {
		return nil
	}
	var fixture problems.Fixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		return err
	}
	p.Examples = fixture.Problem.Examples
	if p.Odyssey != nil && fixture.Problem.Odyssey != nil {
		for i := range p.Odyssey.Levels {
			if i >= len(fixture.Problem.Odyssey.Levels) {
				break
			}
			p.Odyssey.Levels[i].Examples = fixture.Problem.Odyssey.Levels[i].Examples
		}
	}
	return nil
}

func losslessCasesEnabled() bool {
	return os.Getenv("QUOREM_LOSSLESS_CASES") == "true" && os.Getenv("QUOREM_LOSSLESS_RESULT_WRITES") == "true"
}

func enableLosslessCaseWrites(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, "SELECT set_config('quorem.lossless_case_write','v1',true)")
	return err
}
