/** @file editorStateCache.test.ts @description Document and owner isolation across undo, selection and extension restoration. @module editor */
import { history, redo, undo, undoDepth } from "@codemirror/commands";
import { EditorState, Facet, StateEffect, StateField, type Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { EditorStateCache } from "./editorStateCache";

function edited(source: string) {
  const state = EditorState.create({ doc: source, extensions: history() });
  return state.update({
    changes: { from: source.length, insert: " edited" },
    selection: { anchor: 2 },
    userEvent: "input",
  }).state;
}

function command(state: EditorState, run: typeof undo) {
  let result = state;
  expect(run({ state, dispatch: (transaction: Transaction) => (result = transaction.state) })).toBe(
    true,
  );
  return result;
}

describe("document undo cache", () => {
  it("restores independent language undo, redo and selection with fresh extensions", () => {
    const cache = new EditorStateCache();
    const clientField = StateField.define({
      create: () => ({ client: "old language server" }),
      update: (value) => value,
    });
    const python = edited("python").update({
      effects: StateEffect.appendConfig.of(clientField),
    }).state;
    const java = edited("java");
    cache.save("alice:python-workspace:version:python", python);
    cache.save("alice:java-workspace:version:java", java);
    const preference = Facet.define<string, string>({ combine: (values) => values[0] });
    for (const [language, original] of [
      ["python", python],
      ["java", java],
    ] as const) {
      const restored = cache.restore(
        `alice:${language}-workspace:version:${language}`,
        original.doc.toString(),
        [history(), preference.of("fresh")],
      );
      expect(restored.facet(preference)).toBe("fresh");
      expect(restored.field(clientField, false)).toBeUndefined();
      expect(restored.selection.toJSON()).toEqual(original.selection.toJSON());
      expect(undoDepth(restored)).toBe(1);
      const undone = command(restored, undo);
      expect(undone.doc.toString()).toBe(language);
      expect(command(undone, redo).doc.toString()).toBe(`${language} edited`);
    }
  });

  it("never shares owner history or restores history onto replacement source", () => {
    const cache = new EditorStateCache();
    const saved = edited("python");
    cache.save("alice:workspace:version:python", saved);
    expect(
      undoDepth(cache.restore("bob:workspace:version:python", "python edited", history())),
    ).toBe(0);
    const reset = cache.restore("alice:workspace:version:python", "imported source", history());
    expect(reset.doc.toString()).toBe("imported source");
    expect(undoDepth(reset)).toBe(0);
  });

  it("evicts oldest inactive documents after twelve snapshots", () => {
    const cache = new EditorStateCache();
    for (let index = 0; index < 13; index++)
      cache.save(`alice:document-${index}`, edited("source"));
    expect(undoDepth(cache.restore("alice:document-0", "source edited", history()))).toBe(0);
    expect(undoDepth(cache.restore("alice:document-1", "source edited", history()))).toBe(1);
    expect(undoDepth(cache.restore("alice:document-12", "source edited", history()))).toBe(1);
  });
});
