/** @file pythonHighlighting.test.ts @description Python-specific parser contexts and lexical accents. @module editor */
import { highlightTree, tags } from "@lezer/highlight";
import { describe, expect, it } from "vitest";
import { editorSyntaxStyle, parameterTag } from "./syntaxHighlighting";
import { highlightedPython, identifierAccent } from "./pythonHighlighting";

describe("Python syntax recognition", () => {
  it("preserves grammar function/class/method tags while adding parameter and decorator context", () => {
    const source =
      "@cache\nclass Example:\n def solve(self, nums):\n  return self.helper(len(nums))\n";
    const spans: Array<{ text: string; style: string }> = [];
    highlightTree(highlightedPython.parser.parse(source), editorSyntaxStyle, (from, to, style) =>
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
        spans.some((span) => span.text === text && span.style === editorSyntaxStyle.style([tag])),
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
