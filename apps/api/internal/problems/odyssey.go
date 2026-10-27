package problems

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// Each case owns an instance; calls in that case share state.
func OdysseyMethods(p Problem) map[string]Signature {
	methods := map[string]Signature{}
	if p.Odyssey != nil {
		for _, level := range p.Odyssey.Levels {
			for _, sig := range level.Methods {
				methods[sig.MethodName] = sig
			}
		}
	}
	return methods
}

func ValidateOdyssey(c QuestionContent) error {
	levels := c.Problem.Odyssey.Levels
	if len(levels) < 1 || len(levels) > 8 || len(c.OdysseyHiddenCases) != len(levels) {
		return fmt.Errorf("Odyssey requires 1 to 8 levels with a private suite per level")
	}
	methods := map[string]Signature{}
	for i, level := range levels {
		if strings.TrimSpace(level.Title) == "" || len(level.Title) > 160 || strings.TrimSpace(level.StatementMarkdown) == "" || len(level.StatementMarkdown) > 65536 || len(level.Methods) < 1 || len(level.Methods) > 16 || len(level.Examples) < 1 || len(level.Examples) > 20 || len(c.OdysseyHiddenCases[i]) < 1 || len(c.OdysseyHiddenCases[i]) > 20 {
			return fmt.Errorf("invalid Odyssey level %d", i+1)
		}
		for _, sig := range level.Methods {
			if !validOutputOrder(sig) || sig.ClassName != "Solution" || !symbolName.MatchString(sig.MethodName) || len(sig.MethodName) > 80 || len(sig.Parameters) > 16 || (sig.ReturnType != "void" && !validType(sig.ReturnType, 0)) {
				return fmt.Errorf("invalid Odyssey method")
			}
			if _, exists := methods[sig.MethodName]; exists {
				return fmt.Errorf("duplicate Odyssey method")
			}
			seen := map[string]bool{}
			for _, p := range sig.Parameters {
				if !symbolName.MatchString(p.Name) || len(p.Name) > 80 || seen[p.Name] || ValidateInputConfig(p.Type, p.Input) != nil {
					return fmt.Errorf("invalid Odyssey parameter")
				}
				seen[p.Name] = true
			}
			methods[sig.MethodName] = sig
		}
		for _, ex := range level.Examples {
			if err := validateCalls(methods, ex.Case, true, inputLimit(c.Problem)); err != nil {
				return fmt.Errorf("level %d example: %w", i+1, err)
			}
		}
		for _, test := range c.OdysseyHiddenCases[i] {
			if err := validateCalls(methods, test, true, inputLimit(c.Problem)); err != nil {
				return fmt.Errorf("level %d case: %w", i+1, err)
			}
		}
	}
	return nil
}

func validateCalls(methods map[string]Signature, c Case, required bool, limit int) error {
	if len(c.Calls) < 1 || len(c.Calls) > 100 || len(c.Args) > 0 || len(c.Expected) > 0 {
		return fmt.Errorf("sequence requires 1 to 100 calls and empty top-level args")
	}
	for _, call := range c.Calls {
		sig, ok := methods[call.MethodName]
		if !ok {
			return fmt.Errorf("unknown method %s", call.MethodName)
		}
		expect := call.Expected
		if sig.ReturnType == "void" {
			expect = json.RawMessage("null")
			sig.ReturnType = "optional<int>"
		}
		if err := validateCaseLimit(sig, Case{Args: call.Args, Expected: expect}, required, limit); err != nil {
			return err
		}
	}
	return nil
}

func ValidateOdysseyCase(p Problem, c Case, required bool) error {
	return validateCalls(OdysseyMethods(p), c, required, inputLimit(p))
}

// Compile only unlocked methods and cumulative suites into an admitted snapshot.
func CompileOdyssey(f Fixture, level int, kind string) (Problem, []Case, error) {
	p := f.Problem
	if p.Odyssey == nil || level < 1 || level > len(p.Odyssey.Levels) || len(f.OdysseyHiddenCases) != len(p.Odyssey.Levels) {
		return p, nil, fmt.Errorf("invalid Odyssey level")
	}
	p.Odyssey = &Odyssey{Levels: append([]OdysseyLevel{}, p.Odyssey.Levels[:level]...)}
	cases := []Case{}
	for i := 0; i < level; i++ {
		if kind == "run" {
			for _, ex := range p.Odyssey.Levels[i].Examples {
				cases = append(cases, ex.Case)
			}
		} else {
			cases = append(cases, f.OdysseyHiddenCases[i]...)
		}
	}
	return p, cases, nil
}

func NormalizeCaseOutput(p Problem, c Case, data json.RawMessage) (json.RawMessage, error) {
	if p.SQL != nil {
		var value sqlResult
		if len(p.SQL.Output) > 0 && json.Unmarshal(data, &value) == nil {
			if value.Columns == nil {
				for _, column := range p.SQL.Output {
					value.Columns = append(value.Columns, column.Name)
				}
			}
			for _, row := range value.Rows {
				for i, raw := range row {
					if i >= len(p.SQL.Output) {
						break
					}
					kind := p.SQL.Output[i].Type
					if kind != "real" && kind != "double precision" {
						continue
					}
					bits := 64
					if kind == "real" {
						bits = 32
					}
					if len(raw) == 0 || raw[0] == '"' {
						continue
					}
					if number, err := strconv.ParseFloat(string(raw), bits); err == nil {
						row[i] = json.RawMessage(strconv.FormatFloat(number, 'e', -1, 64))
					}
				}
			}
			data, _ = json.Marshal(value)
		}
		return normalizeSQLResult(data, p.SQL.OutputOrder == "unordered")
	}
	if len(c.Calls) == 0 {
		return normalizeMethodOutput(p.Signature, data)
	}
	var values []json.RawMessage
	if err := json.Unmarshal(data, &values); err != nil || len(values) != len(c.Calls) {
		return nil, fmt.Errorf("invalid sequence result")
	}
	methods := OdysseyMethods(p)
	for i, call := range c.Calls {
		sig, ok := methods[call.MethodName]
		if !ok {
			return nil, fmt.Errorf("unknown method")
		}
		var v json.RawMessage
		var err error
		if sig.ReturnType == "void" {
			v = json.RawMessage("null")
		} else {
			v, err = normalizeMethodOutput(sig, values[i])
		}
		if err != nil {
			return nil, err
		}
		values[i] = v
	}
	return json.Marshal(values)
}
func CaseExpected(p Problem, c Case) json.RawMessage {
	if len(c.Calls) == 0 {
		return c.Expected
	}
	values := []json.RawMessage{}
	methods := OdysseyMethods(p)
	for _, call := range c.Calls {
		if methods[call.MethodName].ReturnType == "void" {
			values = append(values, json.RawMessage("null"))
			continue
		}
		if len(call.Expected) == 0 {
			return nil
		}
		values = append(values, call.Expected)
	}
	data, _ := json.Marshal(values)
	return data
}

func validOutputOrder(sig Signature) bool {
	return sig.OutputOrder == "" || sig.OutputOrder == "ordered" || (sig.OutputOrder == "unordered" && (strings.HasPrefix(sig.ReturnType, "list<") || strings.HasPrefix(sig.ReturnType, "array<")))
}

// Canonicalize the outer collection only; duplicates and nested ordering remain significant.
func normalizeMethodOutput(sig Signature, data json.RawMessage) (json.RawMessage, error) {
	value, err := Normalize(sig.ReturnType, data)
	if err != nil {
		return nil, err
	}
	if sig.OutputOrder != "unordered" {
		return value, nil
	}
	var items []json.RawMessage
	if err = json.Unmarshal(value, &items); err != nil {
		return nil, err
	}
	sort.Slice(items, func(i, j int) bool { return bytes.Compare(items[i], items[j]) < 0 })
	return json.Marshal(items)
}
