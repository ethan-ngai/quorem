/** @file semanticHighlighting.ts @description Language-neutral asynchronous semantic colors with stale-response protection. @module editor */
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from "@codemirror/view";
import { editorColor } from "./editorColors";

const roles = ["foreground", "class", "parameter", "function", "builtin", "number"] as const;
export type SemanticRole = (typeof roles)[number];
export type SemanticToken = { from: number; to: number; role: SemanticRole };
export type SemanticRequest = { source: string; ranges: readonly { from: number; to: number }[] };
const received = StateEffect.define<DecorationSet>();
const semanticColors = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    if (transaction.docChanged) value = Decoration.none;
    for (const effect of transaction.effects) if (effect.is(received)) value = effect.value;
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** @returns Valid decorations; providers cannot introduce out-of-document or unsupported spans. */
export function semanticDecorations(
  length: number,
  tokens: readonly SemanticToken[],
): DecorationSet {
  return Decoration.set(
    tokens
      .filter(
        (token) =>
          Number.isInteger(token.from) &&
          Number.isInteger(token.to) &&
          token.from >= 0 &&
          token.to <= length &&
          token.from < token.to &&
          roles.includes(token.role),
      )
      .map((token) =>
        Decoration.mark({ class: `cm-semantic-${token.role}` }).range(token.from, token.to),
      ),
    true,
  );
}

/** @returns A renderer independent of compiler/LSP transport; local syntax remains available during requests or failures. */
export function semanticHighlighting(
  load: (request: SemanticRequest) => Promise<readonly SemanticToken[]>,
): Extension {
  const plugin = ViewPlugin.define((view) => {
    let generation = 0;
    let disposed = false;
    let pending: ReturnType<typeof setTimeout>;
    const request = () => {
      const current = ++generation;
      clearTimeout(pending);
      pending = setTimeout(() => {
        const source = view.state.doc;
        const payload = { source: source.toString(), ranges: view.visibleRanges };
        void Promise.resolve()
          .then(() => load(payload))
          .then((tokens) => {
            if (disposed || current !== generation || view.state.doc !== source) return;
            view.dispatch({ effects: received.of(semanticDecorations(source.length, tokens)) });
          })
          .catch(() => {
            /* Compiler outages leave parser-based highlighting intact. */
          });
      }, 120);
    };
    request();
    return {
      update(update) {
        if (update.docChanged || update.viewportChanged) request();
      },
      destroy() {
        disposed = true;
        generation++;
        clearTimeout(pending);
      },
    };
  });
  return [
    semanticColors,
    plugin,
    EditorView.baseTheme(
      Object.fromEntries(
        roles.map((role) => [
          `.cm-semantic-${role}, .cm-semantic-${role} span`,
          { color: editorColor(role) },
        ]),
      ),
    ),
  ];
}
