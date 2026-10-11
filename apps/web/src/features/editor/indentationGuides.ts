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

function guides(view: EditorView): DecorationSet {
  const ranges: Array<ReturnType<Decoration["range"]>> = [];
  const size = view.state.facet(EditorState.tabSize);
  const seen = new Set<number>();
  for (const visible of view.visibleRanges) {
    let line = view.state.doc.lineAt(visible.from);
    while (line.from <= visible.to) {
      if (!seen.has(line.number)) {
        seen.add(line.number);
        const columns = indentationColumns(line.text, size);
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
        "repeating-linear-gradient(90deg, var(--color-border) 0px, var(--color-border) 1px, transparent 1px, transparent var(--cm-indent-step))",
      backgroundSize: "var(--cm-indent-width) 100%",
      backgroundRepeat: "no-repeat",
      backgroundOrigin: "content-box",
    },
    ".cm-cursor, .cm-dropCursor": { transition: "none" },
  }),
];
