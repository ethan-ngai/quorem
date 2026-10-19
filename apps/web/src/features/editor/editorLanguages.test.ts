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

async function suggestions(language: "java" | "ocaml", doc: string, pos = doc.length) {
  const state = EditorState.create({ doc, extensions: [await loadLanguageExtensions(language)] });
  const sources = state.languageDataAt<CompletionSource | readonly Completion[]>(
    "autocomplete",
    pos,
  );
  const results = await Promise.all(
    sources.map(async (source) =>
      (typeof source === "function" ? source : completeFromList(source))(
        new CompletionContext(state, pos, true),
      ),
    ),
  );
  return results.flatMap((result) => result?.options.map((option) => option.label) ?? []);
}

describe("basic browser completion", () => {
  it.each([
    ["java", "class Solution { int customerCount; void solve() { cust", "return"],
    ["ocaml", "let customer_count = 1\nlet solve () = cust", "match"],
  ] as const)(
    "offers %s keywords and document names without a service",
    async (language, doc, keyword) => {
      const labels = await suggestions(language, doc);
      expect(labels).toContain(keyword);
      expect(labels).toContain(language === "java" ? "customerCount" : "customer_count");
      expect(labels).not.toContain(language === "java" ? "match" : "return");
    },
  );

  it.each([
    ["java", 'class Solution { String text = "cust"; }', "cust"],
    ["java", "// cust", "cust"],
    ["ocaml", 'let text = "cust"', "cust"],
    ["ocaml", "(* cust *)", "cust"],
  ] as const)(
    "suppresses %s suggestions inside literals/comments: %s",
    async (language, doc, marker) => {
      expect(await suggestions(language, doc, doc.indexOf(marker) + marker.length)).toEqual([]);
    },
  );
});
