package problems

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"strings"
)

func ValidateCase(sig Signature, c Case, expectedRequired bool) error {
	if len(c.Args) != len(sig.Parameters) {
		return fmt.Errorf("wrong argument count")
	}
	for i, p := range sig.Parameters {
		if _, err := Normalize(p.Type, c.Args[i]); err != nil {
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
func Normalize(typ string, data json.RawMessage) (json.RawMessage, error) {
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
	norm, err := normalize(typ, v, 0, &n)
	if err != nil {
		return nil, err
	}
	return json.Marshal(norm)
}
func normalize(typ string, v any, depth int, count *int) (any, error) {
	if depth > 100 {
		return nil, fmt.Errorf("nesting exceeds 100")
	}
	if depth > 0 {
		*count++
	}
	if *count > 10000 {
		return nil, fmt.Errorf("collection exceeds 10000 elements")
	}
	if strings.HasPrefix(typ, "optional<") && strings.HasSuffix(typ, ">") {
		if v == nil {
			return nil, nil
		}
		return normalize(typ[9:len(typ)-1], v, depth+1, count)
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
		if len(a) > 10000 {
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
			if _, err := normalize("int", x, depth+1, count); err != nil {
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
			value, err := normalize(typ[5:len(typ)-1], x, depth+1, count)
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
		return f, nil
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
