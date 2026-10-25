/** @file editorPalette.test.ts @description Scheme validation, Python tag coverage and in-place editor reconfiguration. @module editor */
import { history, undoDepth } from "@codemirror/commands";
import { Compartment, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { editorColorTheme, resolveEditorPalette } from "./editorPalette";
import { editorSchemes, normalizeEditorSchemeForMode } from "./editorSchemes";

/** Converts an opaque sRGB palette value into relative luminance. */
function luminance(hex: string) {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r, g, b] = channels.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return r! * 0.2126 + g! * 0.7152 + b! * 0.0722;
}

describe("editor schemes", () => {
  it("rejects invalid persisted values and keeps named schemes independent of app theme", () => {
    expect(normalizeEditorSchemeForMode("darkula", "dark")).toBe("jetbrains-dark");
    expect(normalizeEditorSchemeForMode({ id: "darcula" }, "light")).toBe("jetbrains-light");
    expect(normalizeEditorSchemeForMode("darcula", "dark")).toBe("darcula");
    expect(resolveEditorPalette("darcula", "light").dark).toBe(true);
    expect(resolveEditorPalette("jetbrains-light", "dark").dark).toBe(false);
    expect(resolveEditorPalette("workspace", "light").dark).toBe(false);
    expect(resolveEditorPalette("workspace", "dark").dark).toBe(true);
  });

  it("keeps literal palette text readable on normal and active-line surfaces", () => {
    const roles = [
      "foreground",
      "keyword",
      "string",
      "number",
      "function",
      "class",
      "builtin",
      "parameter",
      "operator",
      "decorator",
      "docComment",
      "docTag",
      "todo",
      "comment",
      "self",
    ] as const;
    for (const { id: scheme } of editorSchemes.filter((entry) => entry.id !== "workspace")) {
      const { colors } = resolveEditorPalette(scheme, "light");
      for (const role of roles) {
        // Token surfaces inherit the shared app palette; check scheme-owned surfaces here.
        for (const background of [colors.background, colors.activeLine].filter((value) =>
          value.startsWith("#"),
        )) {
          const [low, high] = [luminance(colors[role]), luminance(background)].sort(
            (a, b) => a - b,
          );
          expect((high! + 0.05) / (low! + 0.05), `${scheme}: ${role}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("retains edited source, cursor and undo when the visual compartment changes", () => {
    const slot = new Compartment();
    let state = EditorState.create({
      doc: "return 1",
      extensions: [history(), slot.of(editorColorTheme("workspace", "light"))],
    });
    state = state.update({
      changes: { from: 7, to: 8, insert: "2" },
      selection: { anchor: 8 },
    }).state;
    const depth = undoDepth(state);
    state = state.update({ effects: slot.reconfigure(editorColorTheme("darcula", "light")) }).state;
    expect(state.doc.toString()).toBe("return 2");
    expect(state.selection.main.anchor).toBe(8);
    expect(undoDepth(state)).toBe(depth);
    expect(depth).toBeGreaterThan(0);
  });
});
