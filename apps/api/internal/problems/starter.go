package problems

import (
	"fmt"
	"strings"
)

// GenerateStarter builds the initial document from the declared methods.
func GenerateStarter(methods []Signature, language string, staged bool) (string, error) {
	if language == "postgresql" {
		return "-- Write your query here.\n", nil
	}
	if len(methods) == 0 {
		return "", fmt.Errorf("method required")
	}
	if !staged {
		return Starter(methods[0], language)
	}
	bodies := make([]string, 0, len(methods))
	for _, sig := range methods {
		source, err := Starter(sig, language)
		if err != nil {
			return "", err
		}
		if language == "ocaml" {
			if len(sig.Parameters) == 0 {
				source = strings.Replace(source, "let "+sig.MethodName+"  :", "let "+sig.MethodName+" () :", 1)
			}
			bodies = append(bodies, source)
			continue
		}
		marker := "class " + sig.ClassName + " {\n"
		if language == "python" {
			marker = "class " + sig.ClassName + ":\n"
		}
		offset := strings.Index(source, marker)
		if offset < 0 {
			return "", fmt.Errorf("unsupported stage starter")
		}
		body := source[offset+len(marker):]
		if language != "python" {
			body = strings.TrimSuffix(body, "}\n")
		}
		bodies = append(bodies, body)
	}
	if language == "ocaml" {
		return strings.Join(bodies, "\n"), nil
	}
	if language == "python" {
		return "class Solution:\n    def __init__(self):\n        pass\n\n" + strings.Join(bodies, "\n"), nil
	}
	constructor := "    public Solution() {\n    }\n\n"
	if language == "typescript" {
		constructor = "    constructor() {\n    }\n\n"
	}
	return "class Solution {\n" + constructor + strings.Join(bodies, "\n") + "}\n", nil
}
