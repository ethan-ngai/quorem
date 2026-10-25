/** @file documentationComments.ts @description Shared documentation scaffolding and line continuation, configured by language data. @module editor */
import { insertNewlineContinueComment, maybeCloseBlockComment } from "@valtown/codemirror-continue";
import { syntaxTree } from "@codemirror/language";
import { EditorState, Facet, StateEffect, Prec, type StateCommand } from "@codemirror/state";
import { EditorView, ViewPlugin, keymap } from "@codemirror/view";
import { getStyleTags, tags } from "@lezer/highlight";
import { containingComment } from "./commentSyntax";

/** Delimiters and continuation conventions supplied by each language adapter. */
export type DocumentationComment = {
  open: string;
  close: string;
  linePrefix: string;
  closingPrefix: string;
  pairedCloser?: string;
  tags?: (state: EditorState, after: number) => readonly string[];
};

export const starDocumentation: readonly DocumentationComment[] = [
  { open: "/**", close: "*/", linePrefix: " * ", closingPrefix: " " },
];
export const pythonDocumentation: readonly DocumentationComment[] = [
  { open: '"""', close: '"""', linePrefix: "", closingPrefix: "" },
  { open: "'''", close: "'''", linePrefix: "", closingPrefix: "" },
];
export const ocamlDocumentation: readonly DocumentationComment[] = [
  { open: "(**", close: "*)", linePrefix: "  ", closingPrefix: "", pairedCloser: ")" },
];

/** @returns Documentation conventions for the active language, including embedded language contexts. */
function conventions(state: EditorState, position: number) {
  return state
    .languageDataAt<readonly DocumentationComment[]>("documentationComments", position)
    .flat();
}

/** @returns Whether an opener-looking line is inside an existing string or comment. */
function insideLiteral(state: EditorState, position: number) {
  let node = syntaxTree(state).resolveInner(Math.max(0, position - 1), 1);
  for (;;) {
    if (getStyleTags(node)?.tags.some((tag) => tag.set.includes(tags.string))) return true;
    if (!node.parent) return false;
    node = node.parent;
  }
}

/** Enter expands an empty documentation opener or continues its existing line prefix. */
const scaffoldDocumentationComment: StateCommand = ({ state, dispatch }) => {
  const selection = state.selection;
  if (state.readOnly || selection.ranges.length !== 1 || !selection.main.empty) return false;
  const position = selection.main.head;
  const line = state.doc.lineAt(position);
  const before = state.sliceDoc(line.from, position);
  const after = state.sliceDoc(position, line.to);
  const indent = before.match(/^\s*/)?.[0] ?? "";
  for (const config of conventions(state, position)) {
    if (before === indent + config.open && (after.trim() === "" || after.trim() === config.close)) {
      // A standalone triple quote is a docstring scaffold; assignments remain ordinary strings.
      if (config.open !== config.close && insideLiteral(state, position)) continue;
      const body = `${state.lineBreak}${indent}${config.linePrefix}`;
      const templateState =
        after.trim() === config.close
          ? state
          : state.update({ changes: { from: position, to: line.to, insert: ` ${config.close}` } })
              .state;
      const afterComment = templateState.doc.lineAt(position).to;
      const provider = state.facet(documentationTemplateProvider);
      const tagLines = provider ? [] : (config.tags?.(templateState, afterComment) ?? []);
      const tagsText = tagLines
        .map((tag) => `${state.lineBreak}${indent}${config.linePrefix}${tag}`)
        .join("");
      const insert = `${body}${tagsText}${state.lineBreak}${indent}${config.closingPrefix}${config.close}`;
      const templateRequest = provider
        ? requestTemplate.of({
            position,
            from: line.from + indent.length,
            to: position + insert.length,
          })
        : [];
      dispatch(
        state.update({
          changes: { from: position, to: line.to, insert },
          effects: templateRequest,
          selection: { anchor: position + body.length },
          scrollIntoView: true,
          userEvent: "input",
        }),
      );
      return true;
    }
  }
  return false;
};

/** Closing documentation delimiters are inserted once, without changing ordinary comments or strings. */
const closeDocumentationComment = EditorView.inputHandler.of((view, from, to, text) => {
  if (view.state.readOnly || from !== to || text.length !== 1 || insideLiteral(view.state, from))
    return false;
  const line = view.state.doc.lineAt(from);
  const before = view.state.sliceDoc(line.from, from);
  const existingComment = containingComment(view.state, Math.max(0, from - 1));
  if (existingComment && existingComment.from < line.from) return false;
  for (const config of conventions(view.state, from)) {
    if (
      config.open === config.close ||
      before.trimStart() + text !== config.open ||
      view.state.sliceDoc(to, line.to).trimStart().startsWith(config.close)
    )
      continue;
    const pairedCloser = config.pairedCloser;
    if (pairedCloser && view.state.sliceDoc(to, to + pairedCloser.length) === pairedCloser)
      to += pairedCloser.length;
    view.dispatch({
      changes: { from, to, insert: `${text} ${config.close}` },
      selection: { anchor: from + text.length },
      userEvent: "input.type",
    });
    return true;
  }
  return false;
});

/** Enter uses upstream C-style continuation after the shared language-configured scaffold. */
export const continueDocumentationComment: StateCommand = (target) => {
  if (target.state.readOnly) return false;
  return scaffoldDocumentationComment(target) || insertNewlineContinueComment(target);
};

export type DocumentationTemplate = { newText: string; caretOffset: number };
export type DocumentationTemplateRequest = { source: string; position: number };
export const documentationTemplateProvider = Facet.define<
  (request: DocumentationTemplateRequest) => Promise<DocumentationTemplate | null>,
  ((request: DocumentationTemplateRequest) => Promise<DocumentationTemplate | null>) | undefined
>({ combine: (providers) => providers.at(-1) });
const requestTemplate = StateEffect.define<{ position: number; from: number; to: number }>();

const templatePlugin = ViewPlugin.define((view) => {
  let disposed = false;
  return {
    update(update) {
      for (const transaction of update.transactions)
        for (const effect of transaction.effects) {
          if (!effect.is(requestTemplate)) continue;
          const provider = update.state.facet(documentationTemplateProvider);
          if (!provider) continue;
          const document = update.state.doc;
          const selection = update.state.selection;
          // Let the language-service sync listener publish this transaction first.
          void Promise.resolve()
            .then(() => provider({ source: document.toString(), position: effect.value.position }))
            .then((template) => {
              if (
                !template ||
                disposed ||
                view.state.doc !== document ||
                !view.state.selection.eq(selection)
              )
                return;
              view.dispatch({
                changes: { from: effect.value.from, to: effect.value.to, insert: template.newText },
                selection: { anchor: effect.value.from + template.caretOffset },
                userEvent: "input",
              });
            })
            .catch(() => {
              /* A failed language service leaves the editable scaffold available. */
            });
        }
    },
    destroy() {
      disposed = true;
    },
  };
});

export const documentationComments = [
  closeDocumentationComment,
  templatePlugin,
  Prec.high(
    keymap.of([
      { key: "Enter", run: continueDocumentationComment },
      { key: "/", run: (view) => !view.state.readOnly && maybeCloseBlockComment(view) },
    ]),
  ),
];
