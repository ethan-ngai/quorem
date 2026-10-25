package problems

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"strings"
	"unicode/utf8"
)

type ConstraintTarget struct {
	Parameter  string `json:"parameter"`
	Projection string `json:"projection"`
}
type Constraint struct {
	Kind     string            `json:"kind"`
	Target   *ConstraintTarget `json:"target,omitempty"`
	Min      *float64          `json:"min,omitempty"`
	Max      *float64          `json:"max,omitempty"`
	Left     *ConstraintTarget `json:"left,omitempty"`
	Right    *ConstraintTarget `json:"right,omitempty"`
	Operator string            `json:"operator,omitempty"`
	Property string            `json:"property,omitempty"`
	Text     string            `json:"text,omitempty"`
}

// Legacy immutable versions retain their prose; only new metadata is executable.
func (c *Constraint) UnmarshalJSON(data []byte) error {
	data = bytes.TrimSpace(data)
	if len(data) > 0 && data[0] == '"' {
		var prose string
		if err := json.Unmarshal(data, &prose); err != nil {
			return err
		}
		*c = Constraint{Kind: "prose", Text: prose}
		return nil
	}
	type plain Constraint
	var value plain
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return fmt.Errorf("trailing constraint JSON")
	}

	*c = Constraint(value)
	return nil
}

func targetType(sig Signature, t *ConstraintTarget) (string, error) {
	if t == nil {
		return "", fmt.Errorf("missing constraint target")
	}
	var typ string
	for _, p := range sig.Parameters {
		if p.Name == t.Parameter {
			typ = p.Type
			break
		}
	}
	if typ == "" {
		return "", fmt.Errorf("unknown parameter %q", t.Parameter)
	}
	switch t.Projection {
	case "value":
		if typ == "int" || typ == "float" {
			return "scalar", nil
		}
		if typ == "str" {
			return "string", nil
		}
	case "length":
		if typ == "str" || strings.HasPrefix(typ, "list<") {
			return "scalar", nil
		}
	case "sum":
		if typ == "list<int>" || typ == "list<float>" {
			return "scalar", nil
		}
	case "elements":
		if typ == "list<int>" || typ == "list<float>" {
			return "sequence", nil
		}
	case "nodeCount":
		if typ == "ListNode" || typ == "TreeNode" {
			return "scalar", nil
		}
	case "nodeValues":
		if typ == "ListNode" || typ == "TreeNode" {
			return "sequence", nil
		}
	}
	return "", fmt.Errorf("parameter %s: projection %s invalid for %s", t.Parameter, t.Projection, typ)
}
func ValidateConstraints(sig Signature, constraints []Constraint) error {
	names := map[string]bool{}
	for _, p := range sig.Parameters {
		if p.Name == "" || names[p.Name] || !validType(p.Type, 0) {
			return fmt.Errorf("invalid signature parameter %q", p.Name)
		}
		if err := ValidateInputConfig(p.Type, p.Input); err != nil {
			return fmt.Errorf("parameter %s: %w", p.Name, err)
		}
		names[p.Name] = true
	}
	if !validType(sig.ReturnType, 0) {
		return fmt.Errorf("invalid return type")
	}
	for i, c := range constraints {
		fail := func(message string) error { return fmt.Errorf("constraint %d: %s", i+1, message) }
		switch c.Kind {
		case "prose":
			if strings.TrimSpace(c.Text) == "" || c.Target != nil || c.Left != nil || c.Right != nil || c.Min != nil || c.Max != nil || c.Operator != "" || c.Property != "" {
				return fail("invalid prose")
			}
		case "range":
			typ, err := targetType(sig, c.Target)
			if err != nil {
				return fail(err.Error())
			}
			if typ == "string" || c.Min == nil && c.Max == nil || c.Left != nil || c.Right != nil || c.Text != "" || c.Operator != "" || c.Property != "" {
				return fail("invalid range")
			}
			for _, bound := range []*float64{c.Min, c.Max} {
				if bound != nil && (math.IsNaN(*bound) || math.IsInf(*bound, 0)) {
					return fail("nonfinite bound")
				}
			}
			if c.Min != nil && c.Max != nil && *c.Min > *c.Max {
				return fail("reversed bounds")
			}
		case "comparison":
			for _, t := range []*ConstraintTarget{c.Left, c.Right} {
				typ, err := targetType(sig, t)
				if err != nil {
					return fail(err.Error())
				}
				if typ != "scalar" {
					return fail("comparison requires scalar targets")
				}
			}
			if c.Target != nil || c.Min != nil || c.Max != nil || c.Property != "" || c.Text != "" {
				return fail("invalid comparison")
			}
			switch c.Operator {
			case "eq", "le", "lt", "ge", "gt":
			default:
				return fail("invalid comparison operator")
			}
		case "property":
			typ, err := targetType(sig, c.Target)
			if err != nil {
				return fail(err.Error())
			}
			if typ != "sequence" && typ != "string" {
				return fail("property requires a sequence")
			}
			if c.Min != nil || c.Max != nil || c.Left != nil || c.Right != nil || c.Text != "" || c.Operator != "" {
				return fail("invalid property")
			}
			switch c.Property {
			case "unique":
			case "sorted", "nondecreasing":
				if typ != "sequence" {
					return fail("ordering requires numeric sequence")
				}
			default:
				return fail("unsupported property")
			}
		default:
			return fail("unknown kind")
		}
	}
	return nil
}
func project(sig Signature, c Case, t *ConstraintTarget) []float64 {
	var value any
	for i, p := range sig.Parameters {
		if p.Name == t.Parameter {
			normalized, _ := Normalize(p.Type, c.Args[i])
			_ = json.Unmarshal(normalized, &value)
			break
		}
	}
	if t.Projection == "length" {
		if s, ok := value.(string); ok {
			return []float64{float64(utf8.RuneCountInString(s))}
		}
		return []float64{float64(len(value.([]any)))}
	}
	if t.Projection == "value" {
		if s, ok := value.(string); ok {
			result := []float64{}
			for _, r := range s {
				result = append(result, float64(r))
			}
			return result
		}
		return []float64{value.(float64)}
	}
	result := []float64{}
	if value != nil {
		for _, v := range value.([]any) {
			if v != nil {
				result = append(result, v.(float64))
			}
		}
	}
	if t.Projection == "sum" {
		total := float64(0)
		for _, value := range result {
			total += value
		}
		return []float64{total}
	}
	if t.Projection == "nodeCount" {
		return []float64{float64(len(result))}
	}
	return result
}
func ValidateProblemCase(p Problem, c Case, expectedRequired bool) error {
	if p.Odyssey != nil {
		return ValidateOdysseyCase(p, c, expectedRequired)
	}
	if len(c.Calls) > 0 {
		return fmt.Errorf("method sequences require Odyssey")
	}
	if err := ValidateCase(p.Signature, c, expectedRequired); err != nil {
		return err
	}
	if err := ValidateConstraints(p.Signature, p.Constraints); err != nil {
		return err
	}
	for _, rule := range p.Constraints {
		switch rule.Kind {
		case "range":
			for _, v := range project(p.Signature, c, rule.Target) {
				if math.IsNaN(v) || math.IsInf(v, 0) || rule.Min != nil && v < *rule.Min || rule.Max != nil && v > *rule.Max {
					return fmt.Errorf("argument %s: %s outside allowed range", rule.Target.Parameter, rule.Target.Projection)
				}
			}
		case "comparison":
			a, b := project(p.Signature, c, rule.Left)[0], project(p.Signature, c, rule.Right)[0]
			valid := map[string]bool{"eq": a == b, "le": a <= b, "lt": a < b, "ge": a >= b, "gt": a > b}[rule.Operator]
			if !valid || math.IsNaN(a) || math.IsNaN(b) || math.IsInf(a, 0) || math.IsInf(b, 0) {
				return fmt.Errorf("arguments %s and %s: comparison %s failed", rule.Left.Parameter, rule.Right.Parameter, rule.Operator)
			}
		case "property":
			values := project(p.Signature, c, rule.Target)
			seen := map[float64]bool{}
			for i, v := range values {
				if rule.Property == "unique" && seen[v] || rule.Property != "unique" && i > 0 && values[i-1] > v {
					return fmt.Errorf("argument %s: requires %s", rule.Target.Parameter, rule.Property)
				}
				seen[v] = true
			}
		}
	}
	return nil
}
func ValidateProblemCustomCases(p Problem, cases []Case) error {
	if p.Odyssey != nil {
		if len(cases) < 1 || len(cases) > 20 {
			return fmt.Errorf("custom cases must contain 1 to 20 cases")
		}
		data, err := json.Marshal(cases)
		if err != nil || len(data) > 65536 {
			return fmt.Errorf("custom cases exceed 64 KiB")
		}
		for _, c := range cases {
			if err := ValidateOdysseyCase(p, c, false); err != nil {
				return err
			}
		}
		return nil
	}
	if err := ValidateCustomCases(p.Signature, cases); err != nil {
		return err
	}
	for i, c := range cases {
		if err := ValidateProblemCase(p, c, false); err != nil {
			return fmt.Errorf("case %d: %w", i+1, err)
		}
	}
	return nil
}
