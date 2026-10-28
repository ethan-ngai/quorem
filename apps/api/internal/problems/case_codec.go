package problems

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
)

// CaseCodec reuses question metadata while comparing an execution suite.
type CaseCodec struct {
	problem Problem
	methods map[string]Signature
}

func NewCaseCodec(p Problem) *CaseCodec {
	codec := &CaseCodec{problem: p}
	if p.Odyssey != nil && p.SQL == nil {
		codec.methods = OdysseyMethods(p)
	}
	return codec
}

func (codec *CaseCodec) Normalize(c Case, data json.RawMessage) (json.RawMessage, error) {
	p := codec.problem
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
	for i, call := range c.Calls {
		sig, ok := codec.methods[call.MethodName]
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
func (codec *CaseCodec) Expected(c Case) json.RawMessage {
	if len(c.Calls) == 0 {
		return c.Expected
	}
	values := []json.RawMessage{}
	for _, call := range c.Calls {
		if codec.methods[call.MethodName].ReturnType == "void" {
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
