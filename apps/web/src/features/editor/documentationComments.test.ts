/** @file documentationComments.test.ts @description Documentation scaffolding and upstream continuation across language adapters. @module editor */
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, EditorSelection } from "@codemirror/state";
import { history, undo, insertNewlineAndIndent } from "@codemirror/commands";
import { describe, expect, it } from "vitest";
import { loadLanguageExtensions, type EditorLanguage } from "./editorLanguages";
import { continueDocumentationComment } from "./documentationComments";

/** @returns A parsed, undoable document with | marking its cursor. */
async function document(language: EditorLanguage, source: string, readOnly = false) {
  const position = source.indexOf("|");
  const state = EditorState.create({
    doc: source.replace("|", ""),
    selection: { anchor: position },
    extensions: [
      await loadLanguageExtensions(language),
      history(),
      EditorState.readOnly.of(readOnly),
    ],
  });
  ensureSyntaxTree(state, state.doc.length, 1000);
  return state;
}

/** @returns The document and cursor after the real Enter command, or null when normal Enter should take over. */
function enter(state: EditorState) {
  let result: EditorState | undefined;
  const handled = continueDocumentationComment({
    state,
    dispatch: (transaction) => {
      result = transaction.state;
    },
  });
  if (!handled) return null;
  return result!;
}

/** @returns The document with its cursor represented by |. */
function withCursor(state: EditorState) {
  const position = state.selection.main.head;
  return state.sliceDoc(0, position) + "|" + state.sliceDoc(position);
}

describe("documentation editing", () => {
  it.each(["java", "typescript"] as const)(
    "scaffolds %s documentation and retains the closing delimiter",
    async (language) => {
      const initial = await document(language, "    /**| */\n    voidExample();");
      const next = enter(initial)!;
      expect(withCursor(next)).toBe("    /**\n     * |\n     */\n    voidExample();");
      let undone = next;
      expect(
        undo({
          state: next,
          dispatch: (tr) => {
            undone = tr.state;
          },
        }),
      ).toBe(true);
      expect(undone.doc.toString()).toBe(initial.doc.toString());
    },
  );

  it.each(["java", "typescript"] as const)(
    "uses upstream * continuation for %s",
    async (language) => {
      const state = await document(language, "/**\n * A description|\n */");
      expect(withCursor(enter(state)!)).toBe("/**\n * A description\n * |\n */");
    },
  );

  it.each(["java", "typescript"] as const)(
    "adds a missing %s closing delimiter",
    async (language) => {
      expect(withCursor(enter(await document(language, "/**|"))!)).toBe("/**\n * |\n */");
    },
  );

  it.each(['"""', "'''"])("scaffolds Python %s docstrings without adding stars", async (quote) => {
    const state = await document("python", `def solve():\n    ${quote}|${quote}`);
    expect(withCursor(enter(state)!)).toBe(`def solve():\n    ${quote}\n    |\n    ${quote}`);
  });

  it("scaffolds and continues OCaml documentation using its own convention", async () => {
    expect(withCursor(enter(await document("ocaml", "(**| *)"))!)).toBe("(**\n  |\n*)");
    let state = await document("ocaml", "(**\n  Description|\n*)");
    expect(continueDocumentationComment({ state, dispatch: () => {} })).toBe(false);
    insertNewlineAndIndent({
      state,
      dispatch: (transaction) => {
        state = transaction.state;
      },
    });
    expect(withCursor(state)).toBe("(**\n  Description\n  |\n*)");
  });

  it.each([
    ["java", 'String text = "/**|";'],
    ["typescript", 'const text = "/**|";'],
    ["python", 'text = """|"""'],
    ["java", "/* ordinary comment| */"],
    ["typescript", "// ordinary comment|"],
    ["java", "/** done */|"],
    ["ocaml", "(* ordinary comment| *)"],
    ["typescript", "const value = 1;|"],
  ] as const)("leaves ordinary %s editing to the language package", async (language, source) => {
    expect(enter(await document(language, source))).toBeNull();
  });

  it("does not modify read-only documents or selected code", async () => {
    expect(enter(await document("java", "/**|", true))).toBeNull();
    const state = await document("typescript", "/**| */");
    const selected = state.update({ selection: EditorSelection.range(0, 3) }).state;
    expect(enter(selected)).toBeNull();
  });
});

describe("signature-aware documentation templates", () => {
  it("generates Java parameter, return and throws tags from the grammar", async () => {
    const state = await document(
      "java",
      "class Example {\n    /**| */\n    public int solve(int value, String text) throws Exception { return value; }\n}",
    );
    expect(withCursor(enter(state)!)).toBe(
      "class Example {\n    /**\n     * |\n     * @param value\n     * @param text\n     * @return\n     * @throws Exception\n     */\n    public int solve(int value, String text) throws Exception { return value; }\n}",
    );
  });

  it("does not generate return tags for void methods or constructors", async () => {
    for (const declaration of ["void solve(int value) {}", "Example(int value) {}"]) {
      const next = enter(
        await document("java", `class Example {\n    /**| */\n    ${declaration}\n}`),
      )!;
      expect(next.doc.toString()).toContain("@param value");
      expect(next.doc.toString()).not.toContain("@return");
    }
  });

  it("uses grammar-based JSDoc tags before the TypeScript worker is ready", async () => {
    const state = await document(
      "typescript",
      "/**| */\nfunction solve(value: number, text: string): number { return value; }",
    );
    const next = enter(state)!;
    expect(next.doc.toString()).toContain("@param value");
    expect(next.doc.toString()).toContain("@param text");
    expect(next.doc.toString()).toContain("@returns");
  });
});
