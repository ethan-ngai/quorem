import { describe, expect, it } from "vitest";
import { InputPreset, registerInputPreset, resolveInputPreset } from "./inputPresets";
import { parseCustomDraft, parseTypedField } from "./customCases";

describe("typed input presets", () => {
  it("evaluates bounded arithmetic with Python precedence and division", () => {
    for (const [source, expected] of [
      ["10*3", 30],
      ["(5+1)/2", 3],
      ["-2**2", -4],
      ["2**3**2", 512],
      ["-5//2", -3],
      ["-5%2", 1],
      ["1e2 + .5", 100.5],
    ] as const)
      expect(parseTypedField("float", source)).toBe(expected);
    for (const source of [
      "foo",
      "Math.random()",
      "1;2",
      "1🚀",
      "2(3)",
      "1/0",
      "2**2048",
      "1e400",
      "(".repeat(70) + "1" + ")".repeat(70),
    ])
      expect(() => parseTypedField("float", source)).toThrow();
    expect(() => parseTypedField("int", "2147483647+1")).toThrow("integer");
    expect(() => parseTypedField("int", "3/2")).toThrow("integer");
  });

  it("keeps fixed brackets out of editor source and recovers stored arrays", () => {
    const preset = resolveInputPreset("list<int>");
    expect(preset.toEditorSource("[1, 2]")).toBe("1, 2");
    expect(preset.fromEditorSource("10*3, -2")).toBe("[10*3, -2]");
    expect(preset.parse(preset.fromEditorSource("10*3, -2"))).toEqual([30, -2]);
    expect(preset.parse("[1, 2]")).toEqual([1, 2]);
    for (const source of ["", "-", "1, (", "1e-"]) expect(preset.accepts(source)).toBe(true);
    for (const source of ["hello", "1🙂", '"text"', "null"])
      expect(preset.accepts(source)).toBe(false);
  });

  it("parses nested quoted strings, optional entries and node structures", () => {
    expect(parseTypedField("list<list<int>>", "[[2*3], [1+2]]")).toEqual([[6], [3]]);
    expect(parseTypedField("list<str>", '["a,b", "[text]", "雪", "a\\\"b"]')).toEqual([
      "a,b",
      "[text]",
      "雪",
      'a"b',
    ]);
    expect(resolveInputPreset("list<str>").accepts('"雪,🙂"')).toBe(true);
    expect(parseTypedField("list<optional<int>>", "[null, 2*4]")).toEqual([null, 8]);
    expect(resolveInputPreset("TreeNode").accepts("1, null, 2*4")).toBe(true);
    expect(parseTypedField("TreeNode", "[1,null,2*4]")).toEqual([1, null, 8]);
    expect(() => parseTypedField("TreeNode", "[1,null,null,2]")).toThrow("orphan");
    expect(() => parseTypedField("ListNode", "[null]")).toThrow();
    const optional = resolveInputPreset("optional<str>");
    expect(optional.toEditorSource('"snow"')).toBe("snow");
    expect(optional.parse(optional.fromEditorSource("null"))).toBe("null");
    expect(optional.parse("null")).toBeNull();
  });

  it("supports OO registration while unknown server codecs fail closed", () => {
    class DoubleNumber extends InputPreset {
      readonly kind = "number";
      accepts(source: string) {
        return /^\d*$/.test(source);
      }
      protected parseValue(source: string) {
        return Number(source) * 2;
      }
    }
    registerInputPreset("test-double", (type, config) => new DoubleNumber(type, config));
    expect(resolveInputPreset("int", { preset: "test-double" }).parse("3")).toBe(6);
    expect(() => registerInputPreset("test-double", (type) => new DoubleNumber(type))).toThrow(
      "already",
    );
    expect(() => resolveInputPreset("graph").parse("{}")).toThrow("server codec");
    expect(() => resolveInputPreset("int", { preset: "missing" })).toThrow(
      "Unsupported input preset",
    );
    expect(
      parseCustomDraft(
        { id: "one", args: ["3"], expectedEnabled: false, expected: "0" },
        {
          className: "Solution",
          methodName: "solve",
          returnType: "int",
          parameters: [{ name: "n", type: "int", ...{ input: { preset: "test-double" } } }],
        },
      ),
    ).toEqual({ args: [6] });
  });
});
