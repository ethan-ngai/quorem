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
	Dialect     string           `json:"dialect"`
	OutputOrder string           `json:"outputOrder"`
	Tables      []SQLTableSchema `json:"tables,omitempty"`
	Output      []SQLColumn      `json:"output,omitempty"`
}
type SQLColumn struct {
	Name string `json:"name"`
	Type string `json:"type"`
}
type SQLTableSchema struct {
	Name    string      `json:"name"`
	Columns []SQLColumn `json:"columns"`
}
type sqlTable struct {
	Name    string              `json:"name"`
	Columns []SQLColumn         `json:"columns"`
	Rows    [][]json.RawMessage `json:"rows"`
}
type sqlSetup struct {
	Tables []sqlTable `json:"tables"`
}
type sqlResult struct {
	Columns []string            `json:"columns"`
	Rows    [][]json.RawMessage `json:"rows"`
}

func sqlCaseContainsNUL(c Case) bool {
	for _, call := range c.Calls {
		if strings.ContainsRune(call.MethodName, 0) || sqlCaseContainsNUL(Case{Args: call.Args, Expected: call.Expected}) {
			return true
		}
	}
	var contains func(any) bool
	contains = func(value any) bool {
		switch v := value.(type) {
		case string:
			return strings.ContainsRune(v, 0)
		case []any:
			for _, item := range v {
				if contains(item) {
					return true
				}
			}
		case map[string]any:
			for key, item := range v {
				if strings.ContainsRune(key, 0) || contains(item) {
					return true
				}
			}
		}
		return false
	}
	for _, raw := range append(append([]json.RawMessage{}, c.Args...), c.Expected) {
		if len(raw) == 0 {
			continue
		}
		var value any
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.UseNumber()
		if decoder.Decode(&value) == nil && contains(value) {
			return true
		}
	}
	return false
}

func validateSQLCase(config *SQLConfig, c Case, required bool) error {
	if sqlCaseContainsNUL(c) {
		return fmt.Errorf("SQL text cannot contain NUL characters")
	}
	// Published versions predate schemas and remain runnable; new publication requires one.
	if len(config.Tables) == 0 && len(config.Output) == 0 {
		return validateLegacySQLCase(c, required)
	}
	if len(c.Calls) != 0 || len(c.Args) != 1 {
		return fmt.Errorf("SQL case requires one table setup")
	}
	var setup sqlSetup
	if err := json.Unmarshal(c.Args[0], &setup); err != nil || len(setup.Tables) < 1 || len(setup.Tables) > 16 {
		return fmt.Errorf("SQL setup requires 1 to 16 tables")
	}
	if len(config.Tables) == 0 || len(setup.Tables) != len(config.Tables) {
		return fmt.Errorf("SQL case tables must match the schema")
	}
	seen := map[string]bool{}
	for _, table := range setup.Tables {
		var columns []SQLColumn
		for _, schema := range config.Tables {
			if schema.Name == table.Name {
				columns = schema.Columns
				break
			}
		}
		if columns == nil || seen[table.Name] || table.Columns != nil || table.Rows == nil || len(table.Rows) > 200 {
			return fmt.Errorf("SQL case tables must match the schema and contain rows only")
		}
		seen[table.Name] = true
		for _, row := range table.Rows {
			if len(row) != len(columns) {
				return fmt.Errorf("SQL row width mismatch")
			}
			for i, raw := range row {
				if !validSQLValue(columns[i].Type, raw) {
					return fmt.Errorf("invalid SQL table value")
				}
			}
		}
	}
	if len(c.Expected) == 0 && !required {
		return nil
	}
	var result sqlResult
	if err := json.Unmarshal(c.Expected, &result); err != nil || result.Columns != nil || result.Rows == nil || len(result.Rows) > 10000 {
		return fmt.Errorf("SQL expected result must contain rows only")
	}
	for _, row := range result.Rows {
		if len(row) != len(config.Output) {
			return fmt.Errorf("SQL result row width mismatch")
		}
		for i, raw := range row {
			if !validSQLResultValue(config.Output[i].Type, raw) {
				return fmt.Errorf("invalid SQL result value")
			}
		}
	}
	return nil
}

func validateLegacySQLCase(c Case, required bool) error {
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
		if col == "" || len(col) > 256 || strings.ContainsRune(col, 0) {
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
	for i, constraint := range p.Constraints {
		if constraint.Kind != "prose" || !validProseConstraint(constraint) {
			return fmt.Errorf("constraint %d: SQL supports informational prose only", i+1)
		}
	}
	if p.SQL.Dialect != "postgresql" || (p.SQL.OutputOrder != "ordered" && p.SQL.OutputOrder != "unordered") {
		return fmt.Errorf("invalid SQL dialect or output order")
	}
	if len(p.SQL.Tables) < 1 || len(p.SQL.Tables) > 16 || len(p.SQL.Output) < 1 || len(p.SQL.Output) > 32 {
		return fmt.Errorf("SQL input and output schema required")
	}
	seen := map[string]bool{}
	for _, table := range p.SQL.Tables {
		if !symbolName.MatchString(table.Name) || len(table.Name) > 63 || seen[table.Name] || len(table.Columns) < 1 || len(table.Columns) > 32 {
			return fmt.Errorf("invalid SQL table schema")
		}
		seen[table.Name] = true
		if err := validateSQLColumns(table.Columns, false); err != nil {
			return err
		}
	}
	if err := validateSQLColumns(p.SQL.Output, true); err != nil {
		return err
	}
	if p.Odyssey == nil {
		return nil
	}
	if len(p.Odyssey.Levels) < 1 || len(p.Odyssey.Levels) > 8 || len(c.OdysseyHiddenCases) != len(p.Odyssey.Levels) {
		return fmt.Errorf("SQL Odyssey requires 1 to 8 levels with private suites")
	}
	for i, level := range p.Odyssey.Levels {
		if len(level.Methods) != 0 || !validOdysseyLevel(level, c.OdysseyHiddenCases[i]) {
			return fmt.Errorf("invalid SQL Odyssey level %d", i+1)
		}
		for _, test := range c.OdysseyHiddenCases[i] {
			if err := validateSQLCase(p.SQL, test, true); err != nil {
				return err
			}
		}
		for _, example := range level.Examples {
			if err := validateSQLCase(p.SQL, example.Case, true); err != nil {
				return err
			}
		}
	}
	return nil
}
func validateSQLColumns(columns []SQLColumn, output bool) error {
	seen := map[string]bool{}
	for _, col := range columns {
		if (!output && (!symbolName.MatchString(col.Name) || len(col.Name) > 63 || seen[col.Name])) || (output && (col.Name == "" || len(col.Name) > 256)) {
			return fmt.Errorf("invalid SQL column schema")
		}
		switch col.Type {
		case "integer", "bigint", "numeric", "text", "boolean", "date", "timestamp", "timestamptz":
		case "real", "double precision":
			if !output {
				return fmt.Errorf("unsupported SQL column type")
			}
		default:
			return fmt.Errorf("unsupported SQL column type")
		}
		seen[col.Name] = true
	}
	return nil
}
func validSQLResultValue(kind string, raw json.RawMessage) bool {
	if bytes.Equal(raw, []byte("null")) {
		return true
	}
	var marker map[string]string
	if json.Unmarshal(raw, &marker) == nil {
		if kind == "numeric" && len(marker) == 1 {
			value, ok := marker["$numeric"]
			return ok && validSQLValue("numeric", json.RawMessage(strconv.Quote(value)))
		}
		if kind == "bigint" && len(marker) == 1 {
			value, ok := marker["$bigint"]
			return ok && validSQLValue("bigint", json.RawMessage(strconv.Quote(value)))
		}
		return false
	}
	if kind == "numeric" {
		return false
	}
	if kind == "real" || kind == "double precision" {
		if len(raw) == 0 || raw[0] == '"' {
			return false
		}
		var value json.Number
		if json.Unmarshal(raw, &value) != nil {
			return false
		}
		bits := 64
		if kind == "real" {
			bits = 32
		}
		_, err := strconv.ParseFloat(value.String(), bits)
		return err == nil
	}
	if kind == "bigint" {
		var n json.Number
		if json.Unmarshal(raw, &n) != nil {
			return false
		}
		return validSQLValue("integer", raw)
	}
	return validSQLValue(kind, raw)
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
		text, ok := value.(string)
		return ok && !strings.ContainsRune(text, 0)
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
		_, err := parseSQLTimestamp(text)
		return err == nil
	}
	return false
}

func parseSQLTimestamp(text string) (time.Time, error) {
	for _, layout := range []string{"2006-01-02T15:04:05", "2006-01-02 15:04:05", time.RFC3339Nano, "2006-01-02 15:04:05Z07:00"} {
		if value, err := time.Parse(layout, text); err == nil {
			return value, nil
		}
	}
	return time.Time{}, fmt.Errorf("invalid SQL timestamp")
}

// PostgreSQL timestamps without a zone compare by wall time; zoned timestamps compare in UTC.
func normalizeSQLTimestamp(kind, text string) (string, error) {
	value, err := parseSQLTimestamp(text)
	if err != nil {
		return "", err
	}
	// PostgreSQL stores microseconds, rounding halfway values to even.
	micros := value.Nanosecond() / 1000
	if point := strings.IndexByte(text, '.'); point >= 0 {
		end := point + 1
		for end < len(text) && text[end] >= '0' && text[end] <= '9' {
			end++
		}
		digits := text[point+1 : end]
		if len(digits) > 6 && (digits[6] > '5' || digits[6] == '5' && (strings.Trim(digits[7:], "0") != "" || micros%2 == 1)) {
			micros++
		}
	}
	value = value.Add(-time.Duration(value.Nanosecond())).Add(time.Duration(micros) * time.Microsecond)
	if kind == "timestamptz" {
		return value.UTC().Format(time.RFC3339Nano), nil
	}
	return value.Format("2006-01-02T15:04:05.999999999"), nil
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
	case string:
		if strings.ContainsRune(v, 0) {
			return nil, fmt.Errorf("SQL text cannot contain NUL characters")
		}
		return v, nil
	case json.Number:
		if n, err := strconv.ParseInt(v.String(), 10, 64); err == nil && (n > 2147483647 || n < -2147483648) {
			return nil, fmt.Errorf("large SQL integers require a bigint marker")
		}
		return v, nil
	default:
		return value, nil
	}
}
