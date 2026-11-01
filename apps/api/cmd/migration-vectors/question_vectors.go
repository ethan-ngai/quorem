package main

import (
	"encoding/json"
	"strings"

	"github.com/ethan-ngai/quorem/apps/api/internal/problems"
)

func questionVectors() []vector {
	var out []vector
	cases := []struct{ kind, value string }{
		{"timestamp", "2024-02-29 23:59:59.9999995"}, {"timestamp", "2023-12-31T23:59:59.9999995"},
		{"timestamp", "2024-01-01T12:34:56.1234565"}, {"timestamp", "2024-01-01T12:34:56.1234575"},
		{"timestamp", "2024-01-01T12:34:56.1234565001"}, {"timestamp", "2024-01-01 12:00:00+02:00"},
		{"timestamp", "2024-02-30 12:00:00"}, {"timestamp", "0000-01-01 00:00:00"},
		{"timestamp", "9999-12-31 23:59:59.9999995"}, {"timestamptz", "2024-01-01T00:15:00+05:30"},
		{"timestamptz", "2024-01-01 23:45:00-03:30"}, {"timestamptz", "2024-01-01T00:00:00.9999995Z"},
		{"timestamptz", "2024-01-01T00:00:00"}, {"timestamptz", "2024-01-01T00:00:00+24:00"},
		{"timestamptz", "2024-01-01T00:00:00+01:60"}, {"timestamptz", "0000-01-01T00:00:00+01:00"}, {"timestamptz", "2024-01-01T00:00:00+25:00"}, {"timestamptz", "2024-01-01T00:00:00+01:61"}, {"timestamp", "2024-01-01T00:00:00+25:00"},
	}
	for _, c := range cases {
		data, _ := json.Marshal(map[string]any{"rows": [][]string{{c.value}}})
		p := problems.Problem{QuestionDefinition: problems.QuestionDefinition{SQL: &problems.SQLConfig{OutputOrder: "ordered", Output: []problems.SQLColumn{{Name: "value", Type: c.kind}}}}}
		value, err := problems.NewCaseCodec(p).Normalize(problems.Case{}, data)
		out = append(out, result("sqlTimestamp", map[string]string{"type": c.kind, "json": string(data)}, string(value), err))
	}
	for _, value := range []string{"2024-02-29", "2023-02-29", "0000-01-01", "9999-12-31", "2024-2-01", "2024-13-01"} {
		caseJSON, _ := json.Marshal(map[string]any{"args": []any{map[string]any{"tables": []any{map[string]any{"name": "dates", "rows": [][]string{{value}}}}}}, "expected": map[string]any{"rows": [][]string{{value}}}})
		var c problems.Case
		_ = json.Unmarshal(caseJSON, &c)
		p := problems.Problem{QuestionDefinition: problems.QuestionDefinition{SQL: &problems.SQLConfig{Dialect: "postgresql", OutputOrder: "ordered", Tables: []problems.SQLTableSchema{{Name: "dates", Columns: []problems.SQLColumn{{Name: "value", Type: "date"}}}}, Output: []problems.SQLColumn{{Name: "value", Type: "date"}}}}}
		err := problems.ValidateProblemCase(p, c, true)
		out = append(out, result("sqlDateCase", map[string]string{"type": "date", "json": string(caseJSON)}, true, err))
	}

	typed := []struct{ kind, value string }{
		{"int", "-2147483648"}, {"int", "-2147483649"}, {"int", "-0"}, {"int", "1e0"},
		{"float", "1e-7"}, {"float", "1e-6"}, {"float", "1e20"}, {"float", "1e21"}, {"float", "1e-999"}, {"float", "1e999"},
		{"float", "2.2250738585072014e-308"}, {"float", "5e-324"}, {"float", "-0"},
		{"list<int>", "[1,-2,3]"}, {"list<optional<int>>", "[1,null,2]"},
		{"TreeNode", "[null,1]"}, {"TreeNode", "[1,null,null,2]"}, {"TreeNode", "[1,null,null,null]"},
		{"ListNode", "[1,null]"}, {"datetime", `"2024-02-29T23:59:59"`}, {"datetime", `"2023-02-29T00:00:00"`},
		{"str", `"\ud800"`}, {"list<int>", "[" + strings.Repeat("1,", 9999) + "1]"}, {"list<int>", "[" + strings.Repeat("1,", 10000) + "1]"},
	}
	for _, c := range typed {
		value, err := problems.Normalize(c.kind, raw(c.value))
		out = append(out, result("typed", map[string]string{"type": c.kind, "json": c.value}, string(value), err))
	}
	return out
}
