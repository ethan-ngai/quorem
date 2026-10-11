/** @file editorState.test.ts @description Guards CodeMirror history and selection across reconfiguration. @module editor */
import { history, historyField, undo } from "@codemirror/commands";
import { Compartment, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

describe("editor state reconfiguration", () => {
  it("preserves the document, selection, and undo stack when theme and intelligence change", () => {
    const theme = new Compartment();
    const intelligence = new Compartment();
    let state = EditorState.create({
      doc: "answer = 1",
      extensions: [
        history(),
        theme.of(EditorState.tabSize.of(4)),
        intelligence.of([]),
      ],
    });
    state = state.update({
      changes: { from: state.doc.length, insert: "\n" },
      selection: { anchor: state.doc.length + 1 },
      userEvent: "input",
    }).state;

    const configured = state.update({
      effects: [
        theme.reconfigure(EditorState.tabSize.of(2)),
        intelligence.reconfigure(EditorState.allowMultipleSelections.of(true)),
      ],
    }).state;
    expect(configured.doc.toString()).toBe("answer = 1\n");
    expect(configured.selection.main.head).toBe(configured.doc.length);
    expect(configured.field(historyField)).toBeDefined();

    const view = {
      state: configured,
      dispatch(transaction: Parameters<EditorView["dispatch"]>[0]) {
        this.state = this.state.update(transaction).state;
      },
    } as unknown as EditorView;
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("answer = 1");
  });
});
