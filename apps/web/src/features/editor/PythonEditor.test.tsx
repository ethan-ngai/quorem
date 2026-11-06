// @vitest-environment happy-dom
/** @file PythonEditor.test.tsx @description Review layout changes retain the editable document and undo history. @module editor */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { undo, undoDepth } from "@codemirror/commands";
import { afterEach, expect, it, vi } from "vitest";
import { PythonEditor } from "./PythonEditor";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("retains the editor, edits, selection and undo when diff and frozen state change", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // Document-state assertions do not require browser layout measurements.
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const initialSource = "def answer():\n    return 1\n";
  const props = {
    documentKey: `review-test:${crypto.randomUUID()}`,
    documentUri: "file:///workspace/solution.py",
    initialSource,
    theme: "dark" as const,
    colorScheme: "jetbrains-dark" as const,
    fontSize: 15,
    tabSize: 4 as const,
    wrap: false,
    onSourceChange: vi.fn(),
  };
  const editor = () => EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
  try {
    await act(async () => root.render(<PythonEditor {...props} />));
    const originalView = editor();
    await act(async () =>
      originalView.dispatch({
        changes: {
          from: initialSource.indexOf("1"),
          to: initialSource.indexOf("1") + 1,
          insert: "2",
        },
        selection: { anchor: 5 },
        userEvent: "input.type",
      }),
    );
    const edited = originalView.state.doc.toString();
    const history = undoDepth(originalView.state);
    expect(history).toBeGreaterThan(0);
    await act(async () => root.render(<PythonEditor {...props} mergeOriginal={initialSource} />));
    expect(editor()).toBe(originalView);
    expect(editor().state.doc.toString()).toBe(edited);
    expect(editor().state.selection.main.anchor).toBe(5);
    expect(undoDepth(editor().state)).toBe(history);
    expect(editor().state.readOnly).toBe(false);
    await act(async () => root.render(<PythonEditor {...props} readOnly />));
    expect(editor()).toBe(originalView);
    expect(editor().state.readOnly).toBe(true);
    await act(async () => root.render(<PythonEditor {...props} />));
    expect(editor().state.doc.toString()).toBe(edited);
    await act(async () => {
      expect(undo(editor())).toBe(true);
    });
    expect(editor().state.doc.toString()).toBe(initialSource);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
