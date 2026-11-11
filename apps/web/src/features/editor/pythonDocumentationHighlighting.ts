/** @file pythonDocumentationHighlighting.ts @description Adds editor identifier colors to rendered Python code fences. @module editor */
import { highlightedPython, pythonIdentifierClass } from "./pythonHighlighting";

/** Apply the same contextual identifier accents as the editor after sanitizing the LSP markup. */
export function accentPythonDocumentation(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const code of template.content.querySelectorAll("code.language-python, code.language-py")) {
    for (const br of code.querySelectorAll("br")) br.replaceWith("\n");
    code.normalize();

    const last = code.lastChild;
    if (last instanceof Text) last.data = last.data.trimEnd();
    const source = code.textContent ?? "";
    // Pyright prefixes declarations with a symbol kind and prints constructors using class syntax.
    const prefix = /^\([a-z ]+\) (?=[\p{ID_Start}_])/u.exec(source)?.[0].length ?? 0;
    const python = source
      .slice(prefix)
      .replace(/^class(?= \w+\([^\n]*:\s[^\n]*\): \.\.\.$)/gm, "def  ");
    const tree = highlightedPython.parser.parse(python);
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    const accents: { node: Text; from: number; to: number; className: string }[] = [];
    let text = walker.nextNode() as Text | null;
    let offset = 0;
    tree.iterate({
      enter(ref) {
        if (ref.name !== "VariableName" && ref.name !== "PropertyName") return;
        const from = prefix + ref.from;
        const to = prefix + ref.to;
        const className = pythonIdentifierClass(ref.node, (start, end) => python.slice(start, end));
        if (!className) return;
        while (text && offset + text.length <= from) {
          offset += text.length;
          text = walker.nextNode() as Text | null;
        }
        if (text && to <= offset + text.length)
          accents.push({ node: text, from: from - offset, to: to - offset, className });
      },
    });
    // Apply from the end so splitting a text node preserves earlier offsets.
    for (const { node, from, to, className } of accents.reverse()) {
      const range = document.createRange();
      range.setStart(node, from);
      range.setEnd(node, to);
      const span = document.createElement("span");
      span.className = className;
      range.surroundContents(span);
    }
  }
  return template.innerHTML;
}
