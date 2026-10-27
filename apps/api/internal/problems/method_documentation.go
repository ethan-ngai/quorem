package problems

import "strings"

// methodDocumentation escapes comment delimiters so authored text cannot become source code.
func methodDocumentation(sig Signature, language, indent string) string {
	lines := []string{}
	add := func(text string) {
		lines = append(lines, strings.Split(strings.TrimRight(strings.ReplaceAll(text, "\x00", ""), "\n"), "\n")...)
	}
	if strings.TrimSpace(sig.Description) != "" {
		add(sig.Description)
	}
	throws := []MethodException{}
	for _, t := range sig.Throws {
		if strings.TrimSpace(t.Type) != "" || strings.TrimSpace(t.Description) != "" {
			throws = append(throws, t)
		}
	}
	if language == "python" {
		params := []Parameter{}
		for _, p := range sig.Parameters {
			if strings.TrimSpace(p.Description) != "" {
				params = append(params, p)
			}
		}
		if len(params) > 0 {
			if len(lines) > 0 {
				lines = append(lines, "")
			}
			lines = append(lines, "Args:")
			for _, p := range params {
				add("    " + p.Name + ": " + p.Description)
			}
		}
		if strings.TrimSpace(sig.Returns) != "" {
			if len(lines) > 0 {
				lines = append(lines, "")
			}
			lines = append(lines, "Returns:")
			add("    " + sig.Returns)
		}
		if len(throws) > 0 {
			if len(lines) > 0 {
				lines = append(lines, "")
			}
			lines = append(lines, "Raises:")
			for _, t := range throws {
				add("    " + t.Type + ": " + t.Description)
			}
		}
		if len(lines) == 0 {
			return ""
		}
		for i, line := range lines {
			line = strings.ReplaceAll(line, `\`, `\\`)
			lines[i] = strings.ReplaceAll(line, `"""`, `\"\"\"`)
		}
		return indent + "\"\"\"\n" + indent + strings.Join(lines, "\n"+indent) + "\n" + indent + "\"\"\"\n"
	}
	for _, p := range sig.Parameters {
		if strings.TrimSpace(p.Description) != "" {
			add("@param " + p.Name + " " + p.Description)
		}
	}
	if strings.TrimSpace(sig.Returns) != "" {
		tag := "@return "
		if language == "typescript" {
			tag = "@returns "
		}
		add(tag + sig.Returns)
	}
	for _, t := range throws {
		tag := "@throws "
		if language == "ocaml" {
			tag = "@raise "
		}
		add(tag + t.Type + " " + t.Description)
	}
	if len(lines) == 0 {
		return ""
	}
	end := "*/"
	open := "/**"
	if language == "ocaml" {
		end = "*)"
		open = "(**"
	}
	for i, line := range lines {
		lines[i] = strings.ReplaceAll(line, end, string(end[0])+" "+string(end[1]))
		if language == "ocaml" {
			lines[i] = strings.ReplaceAll(lines[i], "(*", "( *")
			lines[i] = strings.ReplaceAll(lines[i], `"`, "”")
		}
	}
	if language == "ocaml" {
		return indent + open + "\n" + indent + "   " + strings.Join(lines, "\n"+indent+"   ") + "\n" + indent + " " + end + "\n"
	}
	return indent + open + "\n" + indent + " * " + strings.Join(lines, "\n"+indent+" * ") + "\n" + indent + " " + end + "\n"
}
