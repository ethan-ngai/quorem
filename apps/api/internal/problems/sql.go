package problems

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math/big"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// SQLConfig defines a single evolving query; cumulative Odyssey stages share its result columns.
var sqlNumeric = regexp.MustCompile(`^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]{1,3})?$`)

type SQLConfig struct {
	Dialect     string `json:"dialect"`
	OutputOrder string `json:"outputOrder"`
}
type sqlColumn struct {
	Name string `json:"name"`
	Type string `json:"type"`
}
type sqlTable struct {
	Name    string              `json:"name"`
	Columns []sqlColumn         `json:"columns"`
	Rows    [][]json.RawMessage `json:"rows"`
}
type sqlSetup struct {
	Tables []sqlTable `json:"tables"`
}
type sqlResult struct {
	Columns []string            `json:"columns"`
	Rows    [][]json.RawMessage `json:"rows"`
}

func validateSQLCase(c Case, required bool) error {
	if len(c.Calls) != 0 || len(c.Args) != 1 {
		return fmt.Errorf("SQL case requires one table setup")
	}
	var setup sqlSetup
	if err := json.Unmarshal(c.Args[0], &setup); err != nil || len(setup.Tables) < 1 || len(setup.Tables) > 16 {
		return fmt.Errorf("SQL setup requires 1 to 16 tables")
	}
	seen := map[string]bool{}
	for _, table := range setup.Tables {
		if !symbolName.MatchString(table.Name) || len(table.Name) > 63 || seen[table.Name] || len(table.Columns) < 1 || len(table.Columns) > 32 || len(table.Rows) > 200 {
			return fmt.Errorf("invalid SQL table")
		}
		seen[table.Name] = true
		columns := map[string]bool{}
		for _, col := range table.Columns {
			if !symbolName.MatchString(col.Name) || len(col.Name) > 63 || columns[col.Name] {
				return fmt.Errorf("invalid SQL column")
			}
			switch col.Type {
			case "integer", "bigint", "numeric", "text", "boolean", "date", "timestamp", "timestamptz":
			default:
				return fmt.Errorf("unsupported SQL column type")
			}
			columns[col.Name] = true
		}
		for _, row := range table.Rows {
			if len(row) != len(table.Columns) {
				return fmt.Errorf("SQL row width mismatch")
			}
			for i, raw := range row {
				if !validSQLValue(table.Columns[i].Type, raw) {
					return fmt.Errorf("invalid SQL table value")
				}
			}
		}
	}
	if len(c.Expected) == 0 && !required {
		return nil
	}
	_, err := normalizeSQLResult(c.Expected, false)
	return err
}

func normalizeSQLResult(data json.RawMessage, unordered bool) (json.RawMessage, error) {
	var result sqlResult
	if err := json.Unmarshal(data, &result); err != nil || result.Columns == nil || result.Rows == nil || len(result.Columns) < 1 || len(result.Columns) > 32 || len(result.Rows) > 10000 {
		return nil, fmt.Errorf("invalid SQL result")
	}
	for _, col := range result.Columns {
		if col == "" || len(col) > 256 {
			return nil, fmt.Errorf("invalid SQL result column")
		}
	}
	rows := make([]json.RawMessage, 0, len(result.Rows))
	for _, row := range result.Rows {
		if len(row) != len(result.Columns) {
			return nil, fmt.Errorf("SQL result row width mismatch")
		}
		values := make([]any, len(row))
		for i, value := range row {
			decoder := json.NewDecoder(bytes.NewReader(value))
			decoder.UseNumber()
			if err := decoder.Decode(&values[i]); err != nil {
				return nil, fmt.Errorf("invalid SQL result value")
			}
			var err error
			values[i], err = canonicalSQLValue(values[i])
			if err != nil {
				return nil, err
			}
		}
		normalized, err := json.Marshal(values)
		if err != nil {
			return nil, err
		}
		rows = append(rows, normalized)
	}
	if unordered {
		sort.Slice(rows, func(i, j int) bool { return bytes.Compare(rows[i], rows[j]) < 0 })
	}
	return json.Marshal(struct {
		Columns []string          `json:"columns"`
		Rows    []json.RawMessage `json:"rows"`
	}{result.Columns, rows})
}

func validateSQLPublication(c QuestionContent) error {
	p := c.Problem
	if p.SQL.Dialect != "postgresql" || (p.SQL.OutputOrder != "ordered" && p.SQL.OutputOrder != "unordered") {
		return fmt.Errorf("invalid SQL dialect or output order")
	}
	if p.Odyssey == nil {
		return nil
	}
	if len(p.Odyssey.Levels) < 1 || len(p.Odyssey.Levels) > 8 || len(c.OdysseyHiddenCases) != len(p.Odyssey.Levels) {
		return fmt.Errorf("SQL Odyssey requires 1 to 8 levels with private suites")
	}
	var columns []string
	var columnTypes []string
	for i, level := range p.Odyssey.Levels {
		if len(level.Methods) != 0 || len(level.Title) == 0 || len(level.StatementMarkdown) == 0 || len(level.Examples) < 1 || len(level.Examples) > 20 || len(c.OdysseyHiddenCases[i]) < 1 || len(c.OdysseyHiddenCases[i]) > 20 {
			return fmt.Errorf("invalid SQL Odyssey level %d", i+1)
		}
		cases := append([]Case{}, c.OdysseyHiddenCases[i]...)
		for _, example := range level.Examples {
			cases = append(cases, example.Case)
		}
		for _, test := range cases {
			if err := validateSQLCase(test, true); err != nil {
				return err
			}
			var result sqlResult
			_ = json.Unmarshal(test.Expected, &result)
			if columns == nil {
				columns = result.Columns
				columnTypes = make([]string, len(columns))
			} else if !equalSQLColumns(columns, result.Columns) {
				return fmt.Errorf("SQL Odyssey stages must share result columns")
			}
			for _, row := range result.Rows {
				for index, raw := range row {
					var value any
					if err := json.Unmarshal(raw, &value); err != nil {
						return err
					}
					if value == nil {
						continue
					}
					typ := fmt.Sprintf("%T", value)
					if marker, ok := value.(map[string]any); ok {
						if _, bigint := marker["$bigint"]; bigint {
							typ = "float64"
						}
					}
					if columnTypes[index] == "" {
						columnTypes[index] = typ
					} else if columnTypes[index] != typ {
						return fmt.Errorf("SQL Odyssey stages must share result types")
					}
				}
			}
		}
	}
	return nil
}
func equalSQLColumns(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func validSQLValue(kind string, raw json.RawMessage) bool {
	var value any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if decoder.Decode(&value) != nil {
		return false
	}
	if value == nil {
		return true
	}
	switch kind {
	case "integer", "bigint":
		var text string
		switch number := value.(type) {
		case json.Number:
			text = number.String()
		case string:
			if kind != "bigint" {
				return false
			}
			text = number
		default:
			return false
		}
		bits := 64
		if kind == "integer" {
			bits = 32
		}
		n, err := strconv.ParseInt(text, 10, bits)
		if err != nil {
			return false
		}
		if _, number := value.(json.Number); number && (n > 2147483647 || n < -2147483648) {
			return false
		}
		return true
	case "numeric":
		var text string
		switch v := value.(type) {
		case json.Number:
			text = v.String()
		case string:
			text = v
		default:
			return false
		}
		if len(text) > 128 {
			return false
		}
		return sqlNumeric.MatchString(text)
	case "text":
		_, ok := value.(string)
		return ok
	case "boolean":
		_, ok := value.(bool)
		return ok
	case "date":
		text, ok := value.(string)
		if !ok {
			return false
		}
		_, err := time.Parse("2006-01-02", text)
		return err == nil
	case "timestamp", "timestamptz":
		text, ok := value.(string)
		if !ok {
			return false
		}
		layouts := []string{"2006-01-02T15:04:05", "2006-01-02 15:04:05", time.RFC3339Nano}
		for _, layout := range layouts {
			if _, err := time.Parse(layout, text); err == nil {
				return true
			}
		}
		return false
	}
	return false
}

// Numeric markers preserve PostgreSQL numeric precision and remain distinct from text.
func canonicalSQLValue(value any) (any, error) {
	switch v := value.(type) {
	case map[string]any:
		if raw, exists := v["$bigint"]; exists {
			text, ok := raw.(string)
			if !ok || len(v) != 1 || len(text) > 20 {
				return nil, fmt.Errorf("invalid SQL bigint value")
			}
			number, err := strconv.ParseInt(text, 10, 64)
			if err != nil {
				return nil, fmt.Errorf("invalid SQL bigint value")
			}
			if number >= -2147483648 && number <= 2147483647 {
				return json.Number(strconv.FormatInt(number, 10)), nil
			}
			return map[string]any{"$bigint": strconv.FormatInt(number, 10)}, nil
		}
		if raw, exists := v["$numeric"]; exists {
			text, ok := raw.(string)
			if !ok || len(v) != 1 || len(text) > 128 || !sqlNumeric.MatchString(text) {
				return nil, fmt.Errorf("invalid SQL numeric value")
			}
			number, ok := new(big.Rat).SetString(text)
			if !ok {
				return nil, fmt.Errorf("invalid SQL numeric value")
			}
			parts := strings.SplitN(strings.ToLower(text), "e", 2)
			exponent := 0
			if len(parts) == 2 {
				exponent, _ = strconv.Atoi(parts[1])
			}
			scale := 0
			if point := strings.IndexByte(parts[0], '.'); point >= 0 {
				scale = len(parts[0]) - point - 1
			}
			scale -= exponent
			if scale < 0 {
				scale = 0
			}
			canonical := number.FloatString(scale)
			if strings.Contains(canonical, ".") {
				canonical = strings.TrimRight(strings.TrimRight(canonical, "0"), ".")
			}
			if canonical == "-0" {
				canonical = "0"
			}
			return map[string]any{"$numeric": canonical}, nil
		}
		return nil, fmt.Errorf("unsupported SQL result value")
	case []any:
		return nil, fmt.Errorf("unsupported SQL result value")
	case json.Number:
		if n, err := strconv.ParseInt(v.String(), 10, 64); err == nil && (n > 2147483647 || n < -2147483648) {
			return nil, fmt.Errorf("large SQL integers require a bigint marker")
		}
		return v, nil
	default:
		return value, nil
	}
}
