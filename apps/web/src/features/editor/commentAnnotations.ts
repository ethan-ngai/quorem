/** @file commentAnnotations.ts @description Parser-aware task markers and documentation tags for every language. @module editor */
import type { DocumentationComment } from "./documentationComments";
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from "@codemirror/view";
import { highlightTree, tags } from "@lezer/highlight";
import { commentBody, commentContextStart, type CommentTokens } from "./commentSyntax";
import { editorColor as syntaxColor } from "./editorColors";

const commentHighlighter = {
  style: (nodeTags: readonly (typeof tags.comment)[]) =>
    nodeTags.some((tag) => tag.set.includes(tags.comment)) ? "comment" : null,
};
const tasks = /\b(TODO|FIXME|BUG|HACK|XXX|NOTE|OPTIMIZE|REVIEW)\b/gi;
const docTags =
  /(?<![\w@])@(param|arg|argument|returns?|throws?|exception|deprecated|type|typedef|template|typeParam|example|see|link|author|since|version|override|inheritdoc)\b/gi;
const urgent = /^(?:FIXME|BUG|XXX)\b/i;
/** @returns Foreground-only task text and documentation tags, restricted to parser-tagged comments. */
export function commentAnnotationDecorations(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
): DecorationSet {
  const marks: ReturnType<Decoration["range"]>[] = [];
  const tree = syntaxTree(state);
  for (const range of ranges) {
    let docActive = false;
    let previousCommentLine = -1;
    let active: { indent: number; line: number; className: string } | undefined;
    const mark = (from: number, to: number, className: string) => {
      from = Math.max(from, range.from);
      to = Math.min(to, range.to);
      if (from < to) marks.push(Decoration.mark({ class: className }).range(from, to));
    };
    highlightTree(
      tree,
      commentHighlighter,
      (from, to) => {
        const tokens = state.languageDataAt<CommentTokens>("commentTokens", from)[0] ?? {};
        const conventions = state
          .languageDataAt<readonly DocumentationComment[]>("documentationComments", from)
          .flat();
        const text = state.sliceDoc(from, to);
        const opensDoc = conventions.some(
          (config) => config.open !== config.close && text.startsWith(config.open),
        );
        const opensBlock = tokens.block && text.startsWith(tokens.block.open);
        if (opensDoc) docActive = true;
        else if (opensBlock || state.doc.lineAt(from).number > previousCommentLine + 1)
          docActive = false;
        if (docActive) mark(from, to, "cm-doc-comment");
        previousCommentLine = state.doc.lineAt(to).number;
        let line = state.doc.lineAt(from);
        while (line.from < to) {
          const start =
            from > line.from && !state.sliceDoc(line.from, from).trim()
              ? line.from
              : Math.max(from, line.from);
          const body = commentBody(state, start, Math.min(to, line.to), tokens);
          const text = state.sliceDoc(body.from, body.to);
          const matches = [...text.matchAll(tasks)];
          if (matches.length) {
            for (let index = 0; index < matches.length; index++) {
              const match = matches[index];
              const className = urgent.test(match[0]) ? "cm-comment-fixme" : "cm-comment-task";
              mark(
                body.from + match.index,
                body.from + (matches[index + 1]?.index ?? text.length),
                className,
              );
              active = { indent: text.slice(0, match.index).length, line: line.number, className };
            }
          } else {
            const indent = text.length - text.trimStart().length;
            if (
              active &&
              line.number === active.line + 1 &&
              text.trim() &&
              indent > active.indent
            ) {
              mark(body.from + indent, body.to, active.className);
              active.line = line.number;
            } else {
              active = undefined;
              for (const match of text.matchAll(docTags))
                mark(
                  body.from + match.index,
                  body.from + match.index + match[0].length,
                  "cm-comment-doc-tag",
                );
            }
          }
          if (line.to >= to || line.number === state.doc.lines) break;
          line = state.doc.line(line.number + 1);
        }
        if (tokens.block && state.sliceDoc(from, to).trimEnd().endsWith(tokens.block.close)) {
          active = undefined;
          docActive = false;
        }
      },
      commentContextStart(state, range.from),
      range.to,
    );
  }
  return Decoration.set(marks, true);
}

const annotationPlugin = ViewPlugin.define(
  (view) => ({
    decorations: commentAnnotationDecorations(view.state, view.visibleRanges),
    update(update) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      ) {
        this.decorations = commentAnnotationDecorations(update.state, update.view.visibleRanges);
      }
    },
  }),
  { decorations: (plugin) => plugin.decorations },
);

export const commentAnnotations = [
  annotationPlugin,
  EditorView.baseTheme({
    ".cm-doc-comment, .cm-doc-comment span": { color: syntaxColor("docComment") },
    ".cm-comment-task, .cm-comment-task span, .cm-doc-comment .cm-comment-task": {
      color: syntaxColor("todo"),
      fontWeight: "600",
      fontStyle: "normal",
    },
    ".cm-comment-fixme, .cm-comment-fixme span, .cm-doc-comment .cm-comment-fixme": {
      color: syntaxColor("todo"),
      fontWeight: "700",
      fontStyle: "normal",
      textDecoration: "underline",
      textUnderlineOffset: "3px",
    },
    ".cm-comment-doc-tag, .cm-comment-doc-tag span, .cm-doc-comment .cm-comment-doc-tag": {
      color: syntaxColor("docTag"),
      fontStyle: "normal",
    },
  }),
];
