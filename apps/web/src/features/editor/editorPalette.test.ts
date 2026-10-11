/** @file editorPalette.test.ts @description Scheme validation, Python tag coverage and in-place editor reconfiguration. @module editor */
import { history, undoDepth } from "@codemirror/commands";
import { Compartment, EditorState } from "@codemirror/state";
import { highlightTree, tags } from "@lezer/highlight";
import { describe, expect, it } from "vitest";
import {
  editorColorTheme,
  normalizeEditorScheme,
  pythonSyntaxStyle,
  resolveEditorPalette,
} from "./editorPalette";
import { highlightedPython, identifierAccent, parameterTag } from "./pythonHighlighting";

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
    expect(normalizeEditorScheme("darkula")).toBe("workspace");
    expect(normalizeEditorScheme({ id: "darcula" })).toBe("workspace");
    expect(normalizeEditorScheme("darcula")).toBe("darcula");
    expect(resolveEditorPalette("darcula", "light").dark).toBe(true);
    expect(resolveEditorPalette("jetbrains-light", "dark").dark).toBe(false);
    expect(resolveEditorPalette("workspace", "light").dark).toBe(false);
    expect(resolveEditorPalette("workspace", "dark").dark).toBe(true);
  });

  it("keeps named palette text readable on normal and active-line surfaces", () => {
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
      "comment",
      "self",
    ] as const;
    for (const scheme of ["jetbrains-light", "darcula", "one-dark"] as const) {
      const { colors } = resolveEditorPalette(scheme, "light");
      for (const role of roles) {
        for (const background of [colors.background, colors.activeLine]) {
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

describe("Python syntax recognition", () => {
  it("preserves grammar function/class/method tags while adding parameter and decorator context", () => {
    const source =
      "@cache\nclass Example:\n def solve(self, nums):\n  return self.helper(len(nums))\n";
    const spans: Array<{ text: string; style: string }> = [];
    highlightTree(highlightedPython.parser.parse(source), pythonSyntaxStyle, (from, to, style) =>
      spans.push({ text: source.slice(from, to), style }),
    );
    for (const [text, tag] of [
      ["cache", tags.annotation],
      ["Example", tags.definition(tags.className)],
      ["solve", tags.function(tags.definition(tags.variableName))],
      ["helper", tags.function(tags.propertyName)],
      ["nums", parameterTag],
    ] as const) {
      expect(
        spans.some((span) => span.text === text && span.style === pythonSyntaxStyle.style([tag])),
        text,
      ).toBe(true);
    }
  });

  it("does not apply builtin accents to declaration names", () => {
    expect(identifierAccent("len", "CallExpression")).toBe("cm-python-builtin");
    expect(identifierAccent("len", "FunctionDefinition")).toBeUndefined();
    expect(identifierAccent("list", "ClassDefinition")).toBeUndefined();
    expect(identifierAccent("str", "ParamList")).toBeUndefined();
    expect(identifierAccent("self", "ParamList")).toBe("cm-python-self");
  });
});
