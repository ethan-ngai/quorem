/** @file pythonHighlighting.ts @description Python parser-context tags and visible lexical identifier accents. @module editor */
import { globalCompletion, localCompletionSource, pythonLanguage } from "@codemirror/lang-python";
import { completeFromList, ifNotIn, type CompletionSource } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { Decoration, ViewPlugin, EditorView, type DecorationSet } from "@codemirror/view";
import { styleTags, tags } from "@lezer/highlight";

import { pythonDocumentation } from "./documentationComments";
import { parameterTag } from "./syntaxHighlighting";
import { editorColor as syntaxColor } from "./editorColors";

type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];

// VariableName rules share one node property; preserve the grammar's original call/definition paths.
export const highlightedPython = pythonLanguage.configure({
  props: [
    styleTags({
      type: tags.definitionKeyword,
      VariableName: tags.variableName,
      "CallExpression/VariableName": tags.function(tags.variableName),
      "FunctionDefinition/VariableName": tags.function(tags.definition(tags.variableName)),
      "ClassDefinition/VariableName": tags.definition(tags.className),
      "ParamList/VariableName": parameterTag,
      "Decorator/VariableName": tags.annotation,
    }),
  ],
});
/** Let the server supply symbol kinds; conflicting local kinds prevent completion deduplication. */
function fallbackCompletion(source: CompletionSource): CompletionSource {
  const normalize = (result: Awaited<ReturnType<CompletionSource>>) =>
    result && {
      ...result,
      options: result.options.map((option) => ({
        ...option,
        type: option.type === "keyword" ? option.type : undefined,
      })),
    };
  return (context) => {
    const result = source(context);
    return result instanceof Promise ? result.then(normalize) : normalize(result);
  };
}
// The language package supplies block snippets, but omits ordinary statement keywords.
const statementCompletion = ifNotIn(
  ["String", "FormatString", "Comment", "PropertyName"],
  completeFromList(
    [
      "and",
      "as",
      "assert",
      "async",
      "await",
      "break",
      "continue",
      "del",
      "elif",
      "else",
      "except",
      "finally",
      "global",
      "in",
      "is",
      "lambda",
      "nonlocal",
      "not",
      "or",
      "pass",
      "raise",
      "return",
      "with",
      "yield",
      "match",
      "case",
    ].map((label) => ({ label, type: "keyword" })),
  ),
);
export const pythonSupport = [
  pythonLanguage.data.of({ documentationComments: pythonDocumentation }),
  pythonLanguage.data.of({ autocomplete: fallbackCompletion(localCompletionSource) }),
  pythonLanguage.data.of({ autocomplete: fallbackCompletion(globalCompletion) }),
  pythonLanguage.data.of({ autocomplete: statementCompletion }),
];

const builtins = new Set([
  "abs",
  "all",
  "any",
  "bool",
  "bytes",
  "callable",
  "chr",
  "dict",
  "divmod",
  "enumerate",
  "filter",
  "float",
  "format",
  "frozenset",
  "getattr",
  "hasattr",
  "hash",
  "hex",
  "id",
  "input",
  "int",
  "isinstance",
  "issubclass",
  "iter",
  "len",
  "list",
  "map",
  "max",
  "min",
  "next",
  "object",
  "open",
  "ord",
  "pow",
  "print",
  "range",
  "repr",
  "reversed",
  "round",
  "set",
  "slice",
  "sorted",
  "str",
  "sum",
  "super",
  "tuple",
  "type",
  "zip",
  "Exception",
  "ValueError",
  "TypeError",
  "IndexError",
  "KeyError",
  "RuntimeError",
]);

/** Lexical recognition only; declaration names and member properties retain parser coloring. */
export function identifierAccent(name: string, parent: string): string | undefined {
  if (parent === "FunctionDefinition" || parent === "ClassDefinition" || parent === "Decorator")
    return;
  if (name === "self" || name === "cls") return "cm-python-self";
  if (parent !== "ParamList" && builtins.has(name)) return "cm-python-builtin";
}

/** Annotation identifiers use grammar ancestry; Literal values and Annotated metadata remain expressions. */
export function pythonTypeIdentifier(
  node: SyntaxNode,
  source: (from: number, to: number) => string,
): boolean {
  if (node.name !== "VariableName" && node.name !== "PropertyName") return false;
  for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (
      parent.name === "TypeDef" ||
      parent.name === "TypeDefinition" ||
      parent.name === "TypeParam"
    )
      return true;
    if (parent.name === "ArgList") return false;
    if (parent.name === "MemberExpression") {
      const base = parent.firstChild;
      const bracket = base?.nextSibling;
      if (base && bracket?.name === "[" && child.from > bracket.from) {
        const name = source(base.from, base.to).split(".").at(-1);
        if (name === "Literal") return false;
        if (name === "Annotated") {
          for (
            let sibling = bracket.nextSibling;
            sibling && sibling.from < child.from;
            sibling = sibling.nextSibling
          ) {
            if (sibling.name === ",") return false;
          }
        }
      }
    }
  }
  return false;
}

/** Limits contextual and lexical accents to visible identifiers; strings and comments retain grammar colors. */
function visibleIdentifiers(view: EditorView): DecorationSet {
  const ranges: Array<ReturnType<Decoration["range"]>> = [];
  const tree = syntaxTree(view.state);
  for (const visible of view.visibleRanges) {
    tree.iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        if (
          (node.name !== "VariableName" && node.name !== "PropertyName") ||
          node.from < visible.from ||
          node.to > visible.to
        )
          return;
        const name = view.state.doc.sliceString(node.from, node.to);
        const className = pythonTypeIdentifier(node.node, (from, to) =>
          view.state.sliceDoc(from, to),
        )
          ? "cm-python-type"
          : node.name === "VariableName"
            ? identifierAccent(name, node.node.parent?.name ?? "")
            : undefined;
        if (className) ranges.push(Decoration.mark({ class: className }).range(node.from, node.to));
      },
    });
  }
  return Decoration.set(ranges, true);
}

export const pythonIdentifierAccents = ViewPlugin.define(
  (view) => ({
    decorations: visibleIdentifiers(view),
    update(update) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      ) {
        this.decorations = visibleIdentifiers(update.view);
      }
    },
  }),
  { decorations: (plugin) => plugin.decorations },
);

export const pythonAccentTheme = EditorView.baseTheme({
  ".cm-python-type, .cm-python-type span": { color: syntaxColor("class") },
  ".cm-python-builtin, .cm-python-builtin span": { color: syntaxColor("builtin") },
  ".cm-python-self, .cm-python-self span": { color: syntaxColor("self") },
});
