/** @file pythonHighlighting.ts @description Python parser-context tags and visible lexical identifier accents. @module editor */
import { globalCompletion, localCompletionSource, pythonLanguage } from "@codemirror/lang-python";
import { completeFromList, ifNotIn, type CompletionSource } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { Decoration, ViewPlugin, EditorView, type DecorationSet } from "@codemirror/view";
import { styleTags, tags } from "@lezer/highlight";

import { pythonDocumentation } from "./documentationComments";
import { parameterTag } from "./syntaxHighlighting";
import { editorColor as syntaxColor } from "./editorColors";

// VariableName rules share one node property; preserve the grammar's original call/definition paths.
export const highlightedPython = pythonLanguage.configure({
  props: [
    styleTags({
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

/** Limits lexical accents to visible identifier nodes, excluding comments, strings and properties. */
function visibleIdentifiers(view: EditorView): DecorationSet {
  const ranges: Array<ReturnType<Decoration["range"]>> = [];
  const tree = syntaxTree(view.state);
  for (const visible of view.visibleRanges) {
    tree.iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        if (node.name !== "VariableName" || node.from < visible.from || node.to > visible.to)
          return;
        const name = view.state.doc.sliceString(node.from, node.to);
        const className = identifierAccent(name, node.node.parent?.name ?? "");
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
  ".cm-python-builtin, .cm-python-builtin span": { color: syntaxColor("builtin") },
  ".cm-python-self, .cm-python-self span": { color: syntaxColor("self") },
});
