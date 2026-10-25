import { describe, expect, it } from "vitest";
import type { OdysseyLevel, Signature } from "@quorem/contracts";
import { initialOdysseySource, methodStub, unlockedMethodEdit } from "./methodStubs";
import type { EditorLanguage } from "../editor/editorLanguages";
const save: Signature = {
  className: "Solution",
  methodName: "save",
  parameters: [
    { name: "id", type: "str" },
    { name: "text", type: "str" },
  ],
  returnType: "void",
};
const get: Signature = {
  className: "Solution",
  methodName: "get",
  parameters: [{ name: "id", type: "str" }],
  returnType: "optional<str>",
};
const stitch: Signature = {
  className: "Solution",
  methodName: "stitch_transcripts",
  parameters: [
    { name: "id", type: "str" },
    { name: "a", type: "list<str>" },
    { name: "b", type: "list<str>" },
  ],
  returnType: "void",
};
const level = (methods: Signature[]): OdysseyLevel => ({
  title: "Stage",
  statementMarkdown: "",
  examples: [],
  methods,
});
const apply = (source: string, edit: Awaited<ReturnType<typeof unlockedMethodEdit>>) =>
  edit ? source.slice(0, edit.from) + edit.insert + source.slice(edit.to) : source;
describe("unlocked method stubs", () => {
  for (const language of ["python", "java", "typescript", "ocaml"] as EditorLanguage[]) {
    it(`preserves earlier code, inserts only unlocked methods and survives reloads in ${language}`, async () => {
      const original = initialOdysseySource([save, get], language);
      const first = await unlockedMethodEdit(original, language, [level([save, get])]);
      expect(first).toBeUndefined();
      const next = apply(
        original,
        await unlockedMethodEdit(original, language, [level([save, get]), level([stitch])]),
      );
      expect(next).toContain("stitch_transcripts");
      expect(next.match(/stitch_transcripts/g)).toHaveLength(1);
      expect(next).toContain(methodStub(save, language).trim());
      expect(
        await unlockedMethodEdit(next, language, [level([save, get]), level([stitch])]),
      ).toBeUndefined();
      expect(next).not.toContain("top_k");
    });
  }
  it("inserts in the Solution class before unrelated Python helpers, preserving custom indentation", async () => {
    const source =
      'class Solution:\n  def save(self, id, text):\n    self.note = "def stitch_transcripts"\n\ndef helper():\n  return 3\n';
    const next = apply(source, await unlockedMethodEdit(source, "python", [level([save, stitch])]));
    expect(next).toContain("  def stitch_transcripts");
    expect(next.indexOf("  def stitch_transcripts")).toBeLessThan(next.indexOf("def helper"));
    expect(next).toContain('self.note = "def stitch_transcripts"');
  });
  it("ignores braces and method names inside TypeScript strings and separate classes", async () => {
    const source =
      'class Solution { save(id: string, text: string): void { const note = "} stitch_transcripts"; } }\nclass Helper {}';
    const next = apply(
      source,
      await unlockedMethodEdit(source, "typescript", [level([save, stitch])]),
    );
    expect(next.indexOf("stitch_transcripts(id:")).toBeLessThan(next.indexOf("class Helper"));
    expect(next).toContain('const note = "} stitch_transcripts"');
  });
  it("does not append to a missing or unfinished class", async () => {
    expect(await unlockedMethodEdit("class Other {}", "java", [level([save])])).toBeUndefined();
    expect(
      await unlockedMethodEdit("class Solution {", "typescript", [level([save])]),
    ).toBeUndefined();
  });
});
