package problems

import (
	"fmt"
	"strings"
)

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
	if strings.HasPrefix(kind, "array<") {
		inner, err := languageType(kind[6:len(kind)-1], language)
		if err != nil {
			return "", err
		}
		switch language {
		case "java":
			return inner + "[]", nil
		case "typescript":
			return "(" + inner + ")[]", nil
		case "ocaml":
			return "(" + inner + ") array", nil
		}
	}
	if strings.HasPrefix(kind, "list<") {
		inner, err := languageType(kind[5:len(kind)-1], language)
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
			return "java.util.List<" + inner + ">", nil
		case "typescript":
			return "(" + inner + ")[]", nil
		case "ocaml":
			return "(" + inner + ") list", nil
		}
	}
	types := map[string]map[string]string{
		"java":       {"void": "void", "int": "int", "float": "double", "bool": "boolean", "str": "String", "ListNode": "ListNode", "TreeNode": "TreeNode"},
		"typescript": {"void": "void", "int": "number", "float": "number", "bool": "boolean", "str": "string", "ListNode": "ListNode | null", "TreeNode": "TreeNode | null"},
		"ocaml":      {"void": "unit", "int": "int", "float": "float", "bool": "bool", "str": "string", "ListNode": "list_node option", "TreeNode": "tree_node option"},
	}
	value, ok := types[language][kind]
	if !ok {
		return "", fmt.Errorf("unsupported type %s for %s", kind, language)
	}
	return value, nil
}

func Starter(signature Signature, language string) (string, error) {
	if language == "python" {
		args := []string{"self"}
		for _, p := range signature.Parameters {
			args = append(args, p.Name)
		}
		return "class " + signature.ClassName + ":\n    def " + signature.MethodName + "(" + strings.Join(args, ", ") + "):\n" + methodDocumentation(signature, language, "        ") + "        raise NotImplementedError\n", nil
	}
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
		return nodeNote + "class " + signature.ClassName + " {\n" + methodDocumentation(signature, language, "    ") + "    public " + result + " " + signature.MethodName + "(" + strings.Join(params, ", ") + ") {\n        throw new UnsupportedOperationException(\"Implement solution\");\n    }\n}\n", nil
	case "typescript":
		return nodeNote + "class " + signature.ClassName + " {\n" + methodDocumentation(signature, language, "    ") + "    " + signature.MethodName + "(" + strings.Join(params, ", ") + "): " + result + " {\n        throw new Error(\"Implement solution\");\n    }\n}\n", nil
	case "ocaml":
		return nodeNote + methodDocumentation(signature, language, "") + "let " + signature.MethodName + " " + strings.Join(params, " ") + " : " + result + " =\n    failwith \"Implement solution\"\n", nil
	}
	return "", fmt.Errorf("unsupported language %s", language)
}
