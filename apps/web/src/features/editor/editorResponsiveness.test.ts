/** Local editing assistance remains synchronous while the language service is slow. */
import { EditorState } from "@codemirror/state";
import { CompletionContext, type CompletionSource } from "@codemirror/autocomplete";
import { describe, expect, it } from "vitest";
import { highlightedPython, pythonSupport } from "./pythonHighlighting";
import { indentationColumns, scopeIndentation } from "./indentationGuides";

describe("editor responsiveness", () => {
  it("supplies builtin completion immediately, without waiting for a remote response", () => {
    const state = EditorState.create({
      doc: "pri",
      extensions: [highlightedPython, pythonSupport],
    });
    const sources = state.languageDataAt<CompletionSource>("autocomplete", 3);
    const results = sources.map((source) => source(new CompletionContext(state, 3, true)));
    expect(results.every((result) => !(result instanceof Promise))).toBe(true);
    expect(
      results.some(
        (result) =>
          result &&
          !(result instanceof Promise) &&
          result.options.some((item) => item.label === "print"),
      ),
    ).toBe(true);
  });

  it("places guides at visual tab stops and stops at actual code", () => {
    expect(indentationColumns(" \t  return 1", 4)).toBe(6);
    expect(indentationColumns("\t\tpass", 2)).toBe(4);
    expect(indentationColumns('return "    "', 4)).toBe(0);
  });
  it("continues nested scope guides through blank lines and stops before dedented code", () => {
    const state = EditorState.create({
      doc: "class Solution:\n\n    def solve(self):\n        value = 1\n\n        return value\n\nnext_value = 2",
    });
    expect(scopeIndentation(state, 2, 4)).toBe(4);
    expect(scopeIndentation(state, 5, 4)).toBe(8);
    expect(scopeIndentation(state, 7, 4)).toBe(0);
  });
});
