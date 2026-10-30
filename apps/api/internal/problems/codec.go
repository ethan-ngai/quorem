package problems

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"strings"
	"time"

	"github.com/ethan-ngai/quorem/internal/execution"
)

func ValidateCase(sig Signature, c Case, expectedRequired bool) error {
	return validateCaseLimit(sig, c, expectedRequired, execution.DefaultLimits().MaxCollectionElements)
}
func validateCaseLimit(sig Signature, c Case, expectedRequired bool, limit int) error {
	if c.Args == nil || len(c.Args) != len(sig.Parameters) {
		return fmt.Errorf("wrong argument count")
	}
	for i, p := range sig.Parameters {
		if _, err := normalizeInput(p.Type, c.Args[i], limit); err != nil {
			return fmt.Errorf("argument %s: %w", p.Name, err)
		}
	}
	if len(c.Expected) > 0 {
		if _, err := Normalize(sig.ReturnType, c.Expected); err != nil {
			return fmt.Errorf("expected: %w", err)
		}
	} else if expectedRequired {
		return fmt.Errorf("missing expected value")
	}
	return nil
}
func validType(typ string, depth int) bool {
	if depth > 100 {
		return false
	}
	switch typ {
	case "int", "float", "bool", "str", "datetime", "ListNode", "TreeNode":
		return true
	}
	for _, wrapper := range []string{"optional<", "list<", "array<"} {
		if strings.HasPrefix(typ, wrapper) && strings.HasSuffix(typ, ">") {
			return validType(typ[len(wrapper):len(typ)-1], depth+1)
		}
	}
	return false
}

func Normalize(typ string, data json.RawMessage) (json.RawMessage, error) {
	return normalizeInput(typ, data, execution.DefaultLimits().MaxCollectionElements)
}
func normalizeInput(typ string, data json.RawMessage, limit int) (json.RawMessage, error) {
	typ = strings.ReplaceAll(typ, "array<", "list<")
	if !validType(typ, 0) {
		return nil, fmt.Errorf("unknown or excessively nested type")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var v any
	if err := decoder.Decode(&v); err != nil {
		return nil, fmt.Errorf("malformed value")
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return nil, fmt.Errorf("malformed value")
	}
	n := 0
	norm, err := normalize(typ, v, 0, &n, limit)
	if err != nil {
		return nil, err
	}
	return json.Marshal(norm)
}
func normalize(typ string, v any, depth int, count *int, limit int) (any, error) {
	if depth > 100 {
		return nil, fmt.Errorf("nesting exceeds 100")
	}
	if depth > 0 {
		*count++
	}
	if *count > limit {
		return nil, fmt.Errorf("collection exceeds %d elements", limit)
	}
	if strings.HasPrefix(typ, "optional<") && strings.HasSuffix(typ, ">") {
		if v == nil {
			return nil, nil
		}
		return normalize(typ[9:len(typ)-1], v, depth+1, count, limit)
	}
	if typ == "ListNode" || typ == "TreeNode" {
		if v == nil {
			return nil, nil
		}
		a, ok := v.([]any)
		if !ok {
			return nil, fmt.Errorf("node requires array or null")
		}
		if len(a) == 0 {
			return nil, nil
		}
		if len(a) > limit {
			return nil, fmt.Errorf("too many nodes")
		}
		if typ == "TreeNode" {
			for len(a) > 0 && a[len(a)-1] == nil {
				a = a[:len(a)-1]
			}
			if len(a) == 0 {
				return nil, nil
			}
		}
		if typ == "TreeNode" && a[0] == nil {
			return nil, fmt.Errorf("null root with children")
		}
		slots := 1
		for _, x := range a {
			if typ == "TreeNode" {
				if slots == 0 {
					return nil, fmt.Errorf("orphan tree node")
				}
				slots--
				if x == nil {
					continue
				}
				slots += 2
			}
			if _, err := normalize("int", x, depth+1, count, limit); err != nil {
				return nil, err
			}
		}
		if typ == "TreeNode" {
			for len(a) > 0 && a[len(a)-1] == nil {
				a = a[:len(a)-1]
			}
		}
		return a, nil
	}
	if strings.HasPrefix(typ, "list<") && strings.HasSuffix(typ, ">") {
		a, ok := v.([]any)
		if !ok {
			return nil, fmt.Errorf("expected list")
		}
		for i, x := range a {
			value, err := normalize(typ[5:len(typ)-1], x, depth+1, count, limit)
			if err != nil {
				return nil, err
			}
			a[i] = value
		}
		return a, nil
	}
	switch typ {
	case "int":
		x, ok := v.(json.Number)
		if !ok {
			return nil, fmt.Errorf("expected integer")
		}
		i, err := x.Int64()
		if err != nil || i < math.MinInt32 || i > math.MaxInt32 {
			return nil, fmt.Errorf("expected signed 32-bit integer")
		}
		return i, nil
	case "float":
		x, ok := v.(json.Number)
		if !ok {
			return nil, fmt.Errorf("expected finite float")
		}
		f, err := x.Float64()
		if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
			return nil, fmt.Errorf("expected finite float")
		}
		// JSON runtimes differ on signed zero; numeric equality uses one wire form.
		if f == 0 {
			return float64(0), nil
		}
		return f, nil
	case "datetime":
		s, ok := v.(string)
		if !ok || len(s) != 19 || s[:4] == "0000" {
			return nil, fmt.Errorf("expected datetime as YYYY-MM-DDTHH:MM:SS")
		}
		parsed, err := time.Parse("2006-01-02T15:04:05", s)
		if err != nil || parsed.Format("2006-01-02T15:04:05") != s {
			return nil, fmt.Errorf("expected datetime as YYYY-MM-DDTHH:MM:SS")
		}
		return s, nil
	case "str":
		s, ok := v.(string)
		if !ok {
			return nil, fmt.Errorf("expected string")
		}
		return s, nil
	case "bool":
		b, ok := v.(bool)
		if !ok {
			return nil, fmt.Errorf("expected bool")
		}
		return b, nil
	}
	return nil, fmt.Errorf("unknown type")
}
