/** Local editing assistance remains synchronous while the language service is slow. */
import { EditorState } from "@codemirror/state";
import { CompletionContext, type CompletionSource } from "@codemirror/autocomplete";
import { describe, expect, it } from "vitest";
import { highlightedPython, pythonSupport } from "./pythonHighlighting";
import { indentationColumns } from "./indentationGuides";

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
});
