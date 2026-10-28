package problems

import (
	"bytes"
	"encoding/json"
	"fmt"
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
	if len(levels[0].Methods) == 0 {
		return fmt.Errorf("Odyssey requires a first-stage method")
	}
	primary, first := c.Problem.Signature, levels[0].Methods[0]
	if primary.Parameters == nil {
		primary.Parameters = []Parameter{}
	}
	if first.Parameters == nil {
		first.Parameters = []Parameter{}
	}
	primaryJSON, _ := json.Marshal(primary)
	firstJSON, _ := json.Marshal(first)
	if !bytes.Equal(primaryJSON, firstJSON) {
		return fmt.Errorf("primary signature must match the first stage method")
	}
	methods := map[string]Signature{}
	for i, level := range levels {
		if strings.TrimSpace(level.Title) == "" || len(level.Title) > 160 || strings.TrimSpace(level.StatementMarkdown) == "" || len(level.StatementMarkdown) > 65536 || len(level.Methods) < 1 || len(level.Methods) > 16 || len(level.Examples) < 1 || len(level.Examples) > 20 || len(c.OdysseyHiddenCases[i]) < 1 || len(c.OdysseyHiddenCases[i]) > 20 {
			return fmt.Errorf("invalid Odyssey level %d", i+1)
		}
		for _, sig := range level.Methods {
			if err := validateSignature(sig, true); err != nil {
				return fmt.Errorf("invalid Odyssey method")
			}
			if _, exists := methods[sig.MethodName]; exists {
				return fmt.Errorf("duplicate Odyssey method")
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

// Compile only unlocked methods and cumulative suites into an admitted snapshot.
func CompileOdyssey(f Fixture, level int, kind string) (Problem, []Case, error) {
	p := f.Problem
	if p.Odyssey == nil || level < 1 || level > len(p.Odyssey.Levels) || (kind != "run" && kind != "submit") || (kind == "submit" && len(f.OdysseyHiddenCases) != len(p.Odyssey.Levels)) {
		return p, nil, fmt.Errorf("invalid Odyssey level")
	}
	p.Odyssey = &Odyssey{Levels: append([]OdysseyLevel{}, p.Odyssey.Levels[:level]...)}
	if kind == "run" {
		return p, p.SampleCases(), nil
	}
	var cases []Case
	for i := 0; i < level; i++ {
		cases = append(cases, f.OdysseyHiddenCases[i]...)
	}
	return p, cases, nil
}

func validOutputOrder(sig Signature) bool {
	return sig.OutputOrder == "" || sig.OutputOrder == "ordered" || (sig.OutputOrder == "unordered" && (strings.HasPrefix(sig.ReturnType, "list<") || strings.HasPrefix(sig.ReturnType, "array<")))
}
