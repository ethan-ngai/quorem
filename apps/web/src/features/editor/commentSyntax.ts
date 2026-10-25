/** @file commentSyntax.ts @description Grammar-based comment context shared by annotations and editing commands. @module editor */
import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { getStyleTags, tags } from "@lezer/highlight";

export type CommentTokens = { line?: string; block?: { open: string; close: string } };

/** @returns The comment node containing a position, using grammar tags rather than delimiter guesses. */
export function containingComment(state: EditorState, position: number) {
  let node = syntaxTree(state).resolveInner(position, 1);
  for (;;) {
    if (getStyleTags(node)?.tags.some((tag) => tag.set.includes(tags.comment))) return node;
    if (!node.parent) return null;
    node = node.parent;
  }
}

/** @returns Start of the adjacent comment run, retaining task context above a scrolled viewport. */
export function commentContextStart(state: EditorState, from: number) {
  let line = state.doc.lineAt(from);
  const own = containingComment(state, Math.min(line.to, line.from + line.text.search(/\S|$/)));
  if (own) line = state.doc.lineAt(own.from);
  while (line.number > 1) {
    const previous = state.doc.line(line.number - 1);
    if (!previous.text.trim()) break;
    const comment = containingComment(state, previous.from + previous.text.search(/\S/));
    if (!comment || comment.to < previous.to) break;
    line = state.doc.lineAt(comment.from);
  }
  return line.from;
}

/** @returns Comment text bounds after removing language-provided delimiters and block-comment leaders. */
export function commentBody(state: EditorState, from: number, to: number, tokens: CommentTokens) {
  const text = state.sliceDoc(from, to);
  const leading = text.length - text.trimStart().length;
  const prefix = [tokens.line, tokens.block?.open].find(
    (token) => token && text.slice(leading).startsWith(token),
  );
  if (prefix) from += leading + prefix.length;
  else if (
    tokens.block?.close.startsWith("*") &&
    text.slice(leading).startsWith("*") &&
    !text.slice(leading).startsWith(tokens.block.close)
  )
    from += leading + 1;
  if (tokens.block && state.sliceDoc(from, to).trimEnd().endsWith(tokens.block.close)) {
    to -=
      state.sliceDoc(from, to).length -
      state.sliceDoc(from, to).trimEnd().length +
      tokens.block.close.length;
  }
  return {
    from,
    to: Math.max(
      from,
      to - (state.sliceDoc(from, to).length - state.sliceDoc(from, to).trimEnd().length),
    ),
  };
}
