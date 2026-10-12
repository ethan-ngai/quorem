import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import {
  CompletionContext,
  completeFromList,
  type Completion,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { describe, expect, it } from "vitest";
import { loadLanguageExtensions } from "./editorLanguages";

describe("language-specific editor grammars", () => {
  it.each([
    ["java", "class Solution { int solve(int value) { return value; } }"],
    ["typescript", "class Solution { solve(value:number):number { return value; } }"],
    ["ocaml", "let solve (value:int) = value"],
  ] as const)("parses %s without Python suggestions", async (language, doc) => {
    const extension = await loadLanguageExtensions(language);
    const state = EditorState.create({ doc, extensions: [extension] });
    expect(syntaxTree(state).length).toBe(doc.length);
    let errors = 0;
    syntaxTree(state).iterate({
      enter(node) {
        if (node.type.isError) errors++;
      },
    });
    expect(errors).toBe(0);
    const sources = state.languageDataAt<CompletionSource | readonly Completion[]>(
      "autocomplete",
      doc.length,
    );
    const results = await Promise.all(
      sources.map(async (source) =>
        (typeof source === "function" ? source : completeFromList(source))(
          new CompletionContext(state, doc.length, true),
        ),
      ),
    );
    expect(results.some((result) => result?.options.some((item) => item.label === "print"))).toBe(
      false,
    );
  });
});
