import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { highlightTree, tagHighlighter, tags } from "@lezer/highlight";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { loadLanguageExtensions, type EditorLanguage } from "../editorLanguages";
import { highlightedPython } from "../pythonHighlighting";
import { parameterTag } from "../syntaxHighlighting";
import "./code-literal.css";

type Tree = NonNullable<ReturnType<typeof ensureSyntaxTree>>;

const styles = tagHighlighter([
  { tag: [tags.keyword, tags.bool, tags.null, tags.atom], class: "code-keyword" },
  { tag: [tags.string, tags.docString, tags.regexp], class: "code-string" },
  { tag: [tags.number, tags.literal], class: "code-number" },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    class: "code-function",
  },
  { tag: [tags.typeName, tags.className], class: "code-type" },
  { tag: [parameterTag, tags.propertyName], class: "code-parameter" },
  { tag: [tags.comment, tags.docComment], class: "code-comment" },
  { tag: tags.operator, class: "code-operator" },
]);

function highlight(source: string, tree: Tree): ReactNode[] {
  let offset = 0;
  const pieces: ReactNode[] = [];
  highlightTree(tree, styles, (from, to, classes) => {
    if (from > offset) pieces.push(source.slice(offset, from));
    pieces.push(
      <span className={classes} key={from}>
        {source.slice(from, to)}
      </span>,
    );
    offset = to;
  });
  if (offset < source.length) pieces.push(source.slice(offset));
  return pieces;
}

/** Highlight source without mounting an editor for each literal in a statement or case. */
export function CodeLiteral({
  source: input,
  language = "python",
  className,
  block = false,
}: {
  source: string;
  language?: EditorLanguage;
  className?: string;
  block?: boolean;
}) {
  const source = input.replace(/\r\n?/g, "\n");
  const [parsed, setParsed] = useState<{ source: string; language: EditorLanguage; tree: Tree }>();
  const withinBudget = source.length <= 20_000;
  useEffect(() => {
    if (language === "python" || !withinBudget || !source) return;
    let cancelled = false;
    void loadLanguageExtensions(language)
      .then((extensions) => {
        if (cancelled) return;
        const state = EditorState.create({ doc: source, extensions });
        const tree = ensureSyntaxTree(state, state.doc.length, 50);
        if (tree) setParsed({ source, language, tree });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [source, language, withinBudget]);
  const text = useMemo(() => {
    if (!withinBudget) return source;
    const tree =
      language === "python"
        ? highlightedPython.parser.parse(source)
        : parsed?.source === source && parsed.language === language
          ? parsed.tree
          : undefined;
    return tree ? highlight(source, tree) : source;
  }, [source, language, withinBudget, parsed]);
  const code = (
    <code className={block ? "code-literal" : (className ?? "code-literal")}>{text}</code>
  );
  return block ? <pre className={className ?? "statement-code"}>{code}</pre> : code;
}
