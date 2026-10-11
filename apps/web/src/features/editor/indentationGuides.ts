/** Visible indentation guides; cursor-only transactions never rebuild them. */
import { EditorState } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from "@codemirror/view";

export function indentationColumns(text: string, tabSize: number): number {
  let columns = 0;
  for (const character of text) {
    if (character === " ") columns++;
    else if (character === "\t") columns += tabSize - (columns % tabSize);
    else break;
  }
  return columns;
}

/** Carry the enclosing indentation through blank separators, without scanning the document. */
export function scopeIndentation(state: EditorState, number: number, size: number): number {
  const line = state.doc.line(number);
  const own = indentationColumns(line.text, size);
  if (line.text.trim() || own) return own;
  function neighbor(direction: -1 | 1): number | undefined {
    for (let distance = 1; distance <= 20; distance++) {
      const candidate = number + distance * direction;
      if (candidate < 1 || candidate > state.doc.lines) return;
      const text = state.doc.line(candidate).text;
      if (text.trim())
        return (
          indentationColumns(text, size) +
          (direction === -1 && text.trimEnd().endsWith(":") ? size : 0)
        );
    }
  }
  const before = neighbor(-1),
    after = neighbor(1);
  return before === undefined
    ? (after ?? 0)
    : after === undefined
      ? before
      : Math.min(before, after);
}

function guides(view: EditorView): DecorationSet {
  const ranges: Array<ReturnType<Decoration["range"]>> = [];
  const size = view.state.facet(EditorState.tabSize);
  const seen = new Set<number>();
  for (const visible of view.visibleRanges) {
    let line = view.state.doc.lineAt(visible.from);
    while (line.from <= visible.to) {
      if (!seen.has(line.number)) {
        seen.add(line.number);
        const columns = scopeIndentation(view.state, line.number, size);
        if (columns >= size) {
          ranges.push(
            Decoration.line({
              class: "cm-indent-guides",
              attributes: { style: `--cm-indent-width:${columns}ch;--cm-indent-step:${size}ch` },
            }).range(line.from),
          );
        }
      }
      if (line.number === view.state.doc.lines) break;
      line = view.state.doc.line(line.number + 1);
    }
  }
  return Decoration.set(ranges, true);
}

export const indentationGuides = [
  ViewPlugin.define(
    (view) => ({
      decorations: guides(view),
      update(update) {
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.state.facet(EditorState.tabSize) !== update.startState.facet(EditorState.tabSize)
        )
          this.decorations = guides(update.view);
      },
    }),
    { decorations: (plugin) => plugin.decorations },
  ),
  EditorView.baseTheme({
    ".cm-indent-guides": {
      backgroundImage:
        "repeating-linear-gradient(90deg, var(--editor-border) 0px, var(--editor-border) 1px, transparent 1px, transparent var(--cm-indent-step))",
      backgroundSize: "var(--cm-indent-width) 100%",
      backgroundRepeat: "no-repeat",
      backgroundOrigin: "content-box",
    },
    ".cm-cursor, .cm-dropCursor": { transition: "none" },
  }),
];
