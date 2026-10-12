package problems

import (
	"embed"
	"fmt"
	"github.com/ethan-ngai/quorem/internal/execution"
	"strings"
)

//go:embed references/*/*.txt
var referenceSources embed.FS

// Implementations registers explicit local artifacts, never exposing private references publicly.
func Implementations(f Fixture) ([]LanguageImplementation, map[string]string, error) {
	result := []LanguageImplementation{{Language: "python", StarterSource: f.Problem.StarterSource, RuntimeRevision: f.Problem.RuntimeRevision, HarnessRevision: execution.HarnessRevision}}
	references := map[string]string{"python": f.ReferenceSource}
	for _, language := range []string{"java", "typescript", "ocaml"} {
		source, err := referenceSources.ReadFile("references/" + language + "/" + f.Problem.Slug + ".txt")
		if err != nil {
			return nil, nil, err
		}
		runtime, _ := execution.LanguageRuntime(language)
		starter, err := Starter(f.Problem.Signature, language)
		if err != nil {
			return nil, nil, err
		}
		result = append(result, LanguageImplementation{Language: language, StarterSource: starter, RuntimeRevision: runtime.Revision, HarnessRevision: runtime.Harness})
		references[language] = string(source)
	}
	return result, references, nil
}

func languageType(kind, language string) (string, error) {
	if strings.HasPrefix(kind, "optional<") {
		inner, err := languageType(kind[9:len(kind)-1], language)
		if err != nil {
			return "", err
		}
		switch language {
		case "java":
			switch inner {
			case "int":
				inner = "Integer"
			case "double":
				inner = "Double"
			case "boolean":
				inner = "Boolean"
			}
			return inner, nil
		case "typescript":
			return inner + " | null", nil
		case "ocaml":
			return "(" + inner + ") option", nil
		}
	}
	if strings.HasPrefix(kind, "list<") {
		inner, err := languageType(kind[5:len(kind)-1], language)
		if err != nil {
			return "", err
		}
		switch language {
		case "java":
			return inner + "[]", nil
		case "typescript":
			return "(" + inner + ")[]", nil
		case "ocaml":
			return "(" + inner + ") list", nil
		}
	}
	types := map[string]map[string]string{
		"java":       {"int": "int", "float": "double", "bool": "boolean", "str": "String", "ListNode": "ListNode", "TreeNode": "TreeNode"},
		"typescript": {"int": "number", "float": "number", "bool": "boolean", "str": "string", "ListNode": "ListNode | null", "TreeNode": "TreeNode | null"},
		"ocaml":      {"int": "int", "float": "float", "bool": "bool", "str": "string", "ListNode": "list_node option", "TreeNode": "tree_node option"},
	}
	value, ok := types[language][kind]
	if !ok {
		return "", fmt.Errorf("unsupported type %s for %s", kind, language)
	}
	return value, nil
}

func Starter(signature Signature, language string) (string, error) {
	nodeNote := ""
	for _, p := range append(signature.Parameters, Parameter{Type: signature.ReturnType}) {
		if strings.Contains(p.Type, "Node") {
			switch language {
			case "java", "typescript":
				nodeNote = "// Judge supplies ListNode(val, next) and TreeNode(val, left, right).\n"
			case "ocaml":
				nodeNote = "(* Judge supplies mutable list_node {value:int; next:list_node option} and tree_node {value:int; left:tree_node option; right:tree_node option}. *)\n"
			}
			break
		}
	}
	result, err := languageType(signature.ReturnType, language)
	if err != nil {
		return "", err
	}
	params := []string{}
	for _, p := range signature.Parameters {
		t, e := languageType(p.Type, language)
		if e != nil {
			return "", e
		}
		switch language {
		case "java":
			params = append(params, t+" "+p.Name)
		case "typescript":
			params = append(params, p.Name+": "+t)
		case "ocaml":
			params = append(params, "("+p.Name+":"+t+")")
		}
	}
	switch language {
	case "java":
		return nodeNote + "class " + signature.ClassName + " {\n    public " + result + " " + signature.MethodName + "(" + strings.Join(params, ", ") + ") {\n        throw new UnsupportedOperationException(\"Implement solution\");\n    }\n}\n", nil
	case "typescript":
		return nodeNote + "class " + signature.ClassName + " {\n    " + signature.MethodName + "(" + strings.Join(params, ", ") + "): " + result + " {\n        throw new Error(\"Implement solution\");\n    }\n}\n", nil
	case "ocaml":
		return nodeNote + "let " + signature.MethodName + " " + strings.Join(params, " ") + " : " + result + " =\n    failwith \"Implement solution\"\n", nil
	}
	return "", fmt.Errorf("unsupported language %s", language)
}
