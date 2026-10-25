/** @file typeScriptSemanticTokens.test.ts @description Real compiler symbol classifications, scope resolution and stale snapshots. @module editor */
import { describe, expect, it } from "vitest";
import { createBrowserTypeScriptEnvironment } from "./browserTypeScriptEnvironment";
import { createTypeScriptWorker } from "./typeScriptSemanticTokens";
import { semanticDecorations } from "./semanticHighlighting";

/** @returns A ready worker adapter using bundled compiler libraries and the supplied document. */
async function compiler(source: string) {
  const worker = createTypeScriptWorker(createBrowserTypeScriptEnvironment);
  await worker.initialize();
  worker.updateFile({ path: "/main.ts", code: source });
  return worker;
}

describe("TypeScript compiler semantic colors", () => {
  it("resolves parameter references through closures without coloring unrelated same-name variables", async () => {
    const source =
      "function solve(value: number) { const closure = () => value; return value; } let value = 1; value++; // value\nconst text = 'value';";
    const worker = await compiler(source);
    const tokens = worker.getSemanticTokens({
      path: "/main.ts",
      source,
      ranges: [{ from: 0, to: source.length }],
    });
    const values = tokens.filter((token) => source.slice(token.from, token.to) === "value");
    expect(values.map((token) => token.role)).toEqual([
      "parameter",
      "parameter",
      "parameter",
      "foreground",
      "foreground",
    ]);
    expect(values).toHaveLength(5);
  });

  it("classifies types, methods, properties and standard-library symbols", async () => {
    const source =
      "interface Item { count: number } class Example { solve(item: Item): Item { console.log(item.count); return item; } }";
    const worker = await compiler(source);
    const tokens = worker.getSemanticTokens({
      path: "/main.ts",
      source,
      ranges: [{ from: 0, to: source.length }],
    });
    for (const [text, role] of [
      ["Item", "class"],
      ["Example", "class"],
      ["solve", "function"],
      ["item", "parameter"],
      ["count", "parameter"],
      ["console", "builtin"],
    ]) {
      expect(
        tokens.some((token) => source.slice(token.from, token.to) === text && token.role === role),
        text,
      ).toBe(true);
    }
  });

  it("rejects old source snapshots without overwriting newer compiler state", async () => {
    const old = "function solve(value: number) { return value; }";
    const current = "const current = 1;";
    const worker = await compiler(old);
    worker.updateFile({ path: "/main.ts", code: current });
    expect(
      worker.getSemanticTokens({
        path: "/main.ts",
        source: old,
        ranges: [{ from: 0, to: old.length }],
      }),
    ).toEqual([]);
    expect(worker.getEnv().getSourceFile("/main.ts")?.text).toBe(current);
  });

  it("limits semantic requests to the viewport and rejects invalid decoration spans", async () => {
    const source = "function solve(value: number) { return value; }";
    const from = source.lastIndexOf("value");
    const worker = await compiler(source);
    const tokens = worker.getSemanticTokens({
      path: "/main.ts",
      source,
      ranges: [{ from, to: from + 5 }],
    });
    expect(tokens).toEqual([{ from, to: from + 5, role: "parameter" }]);
    const decorations = semanticDecorations(source.length, [
      ...tokens,
      { from: -1, to: 2, role: "class" },
      { from: 0, to: source.length + 1, role: "class" },
    ]);
    expect(decorations.size).toBe(1);
  });
});

it("uses the TypeScript compiler to generate JSDoc for the following function", async () => {
  const source = "/**\n * \n */\nfunction solve(value: number): number { return value; }";
  const worker = await compiler(source);
  const template = worker.getDocumentationTemplate({ path: "/main.ts", source, position: 3 });
  expect(template?.newText).toContain("@param value");
  expect(template?.newText).toContain("@returns");
  expect(template?.caretOffset).toBeGreaterThan(3);
  worker.updateFile({ path: "/main.ts", code: "const changed = 1;" });
  expect(worker.getDocumentationTemplate({ path: "/main.ts", source, position: 3 })).toBeNull();
});
