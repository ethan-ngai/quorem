package problems

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"unicode/utf8"
)

type InputConfig struct {
	Preset      string  `json:"preset"`
	Placeholder *string `json:"placeholder,omitempty"`
	Rows        *int    `json:"rows,omitempty"`
}

func (c *InputConfig) UnmarshalJSON(data []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	if fields == nil {
		return fmt.Errorf("input config requires object")
	}
	for name, value := range fields {
		if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return fmt.Errorf("input %s cannot be null", name)
		}
	}
	type plain InputConfig
	var value plain
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return fmt.Errorf("trailing input config JSON")
	}
	*c = InputConfig(value)
	return nil
}

type inputPresetCompatibility func(string) bool

func inputTypes(types ...string) inputPresetCompatibility {
	return func(typ string) bool {
		for _, candidate := range types {
			if typ == candidate {
				return true
			}
		}
		return false
	}
}

func inputListOf(compatible inputPresetCompatibility) inputPresetCompatibility {
	return func(typ string) bool {
		return strings.HasPrefix(typ, "list<") && strings.HasSuffix(typ, ">") && compatible(typ[5:len(typ)-1])
	}
}

// New presets register compatibility here; presentation never expands the wire codec.
var inputPresets = map[string]inputPresetCompatibility{
	"default":    func(typ string) bool { return validType(typ, 0) },
	"number":     inputTypes("int", "float"),
	"text":       inputTypes("str"),
	"boolean":    inputTypes("bool"),
	"sequence":   inputListOf(inputTypes("int", "float", "str", "bool")),
	"matrix":     inputListOf(inputListOf(inputTypes("int", "float", "str", "bool"))),
	"tree":       inputTypes("TreeNode"),
	"linkedList": inputTypes("ListNode"),
	"structured": func(typ string) bool { return validType(typ, 0) },
}

func ValidateInputConfig(typ string, config *InputConfig) error {
	if !validType(typ, 0) {
		return fmt.Errorf("unknown input codec %q", typ)
	}
	if config == nil {
		return nil
	}
	compatible, ok := inputPresets[config.Preset]
	if !ok {
		return fmt.Errorf("unknown input preset %q", config.Preset)
	}
	for strings.HasPrefix(typ, "optional<") {
		typ = typ[9 : len(typ)-1]
	}
	if !compatible(typ) {
		return fmt.Errorf("input preset %q incompatible with %s", config.Preset, typ)
	}
	if config.Rows != nil && (*config.Rows < 1 || *config.Rows > 8) {
		return fmt.Errorf("input rows must be 1 to 8")
	}
	if config.Placeholder != nil && (!utf8.ValidString(*config.Placeholder) || utf8.RuneCountInString(*config.Placeholder) > 512) {
		return fmt.Errorf("input placeholder exceeds 512 characters")
	}
	return nil
}
