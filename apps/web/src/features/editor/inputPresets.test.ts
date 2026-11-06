import { describe, expect, it } from "vitest";
import {
  inputPresetSchemas,
  InputPreset,
  registerInputPreset,
  resolveInputPreset,
} from "./inputPresets";
import type { ProblemVersion } from "@quorem/contracts";
import { createCustomDraft, parseCustomDraft, parseTypedField } from "./customCases";

describe("typed input presets", () => {
  it("declares presentation delimiters for each built-in literal shape", () => {
    expect(resolveInputPreset("str").delimiters).toEqual(['"', '"']);
    for (const type of ["list<int>", "list<list<int>>", "ListNode"])
      expect(resolveInputPreset(type).delimiters).toEqual(["[", "]"]);
    for (const type of ["int", "float", "bool", "TreeNode"])
      expect(resolveInputPreset(type).delimiters).toBeUndefined();
  });
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
      "9007199254740993-9007199254740992",
      "9007199254740991+2-9007199254740991",
      "foo",
      "Math.random()",
      "1;2",
      "1🚀",
      "2(3)",
      "1/0",
      "2**2048",
      "1e400",
      "1e400**0",
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
    for (const source of ["1,[2]", "hello", "1🙂", '"text"', "null"])
      expect(preset.accepts(source)).toBe(false);
  });

  it("parses nested quoted strings, optional entries and node structures", () => {
    expect(resolveInputPreset("list<list<int>>").accepts("[1,2],[3]")).toBe(true);
    expect(resolveInputPreset("list<optional<ListNode>>").accepts("[1,2],null")).toBe(true);
    expect(resolveInputPreset("list<str>").accepts('"[text]"')).toBe(true);
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
    expect(resolveInputPreset("ListNode").toEditorSource("null")).toBe("");
    expect(resolveInputPreset("optional<list<int>>", { preset: "sequence" }).kind).toBe("optional");
    const optional = resolveInputPreset("optional<str>", { preset: "text" });
    expect(optional.toEditorSource('"snow"')).toBe("snow");
    expect(optional.parse(optional.fromEditorSource("null"))).toBe("null");
    expect(optional.parse("null")).toBeNull();
  });

  it("seeds configured structured strings in their stored representation", () => {
    const problem: ProblemVersion = {
      id: "one",
      slug: "echo",
      version: "1",
      title: "Echo",
      difficulty: "easy",
      tags: [],
      statementMarkdown: "Echo",
      examples: [{ args: ["hello"], expected: "hello" }],
      constraints: [],
      signature: {
        className: "Solution",
        methodName: "solve",
        parameters: [{ name: "text", type: "str", input: { preset: "structured" } }],
        returnType: "str",
      },
      starterSource: "",
      runtimeRevision: "1",
      limits: {
        wallTimeMs: 1000,
        memoryBytes: 128000000,
        outputBytes: 65536,
        maxProcesses: 1,
        maxCollectionElements: 10000,
        maxNestingDepth: 100,
      },
    };
    const draft = createCustomDraft(problem);
    expect(draft.args).toEqual(['"hello"']);
    expect(parseCustomDraft(draft, problem.signature)).toEqual({ args: ["hello"] });
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
          parameters: [{ name: "n", type: "int", input: { preset: "test-double" } }],
        },
      ),
    ).toEqual({ args: [6] });
  });
});

it("round-trips long scalar, optional and list inputs without number coercion", () => {
  const max = "9223372036854775807";
  const min = "-9223372036854775808";
  const scalar = resolveInputPreset("long");
  expect(scalar.parse(max)).toBe(max);
  expect(() => scalar.parse("9223372036854775808")).toThrow("signed 64-bit");
  const optional = resolveInputPreset("optional<long>");
  expect(optional.parse(optional.format(min))).toBe(min);
  expect(optional.parse("null")).toBeNull();
  const list = resolveInputPreset("list<long>");
  expect(list.parse(`[${max},${min}]`)).toEqual([max, min]);
  expect(list.parse(list.format([max, min]))).toEqual([max, min]);
});

it("edits generic trees with structural nulls and lossless long payloads", () => {
  const preset = resolveInputPreset("TreeNode<long>");
  expect(preset.accepts('9007199254740993, null, "9223372036854775807"')).toBe(true);
  expect(preset.parse('[9007199254740993, null, "9223372036854775807"]')).toEqual([
    "9007199254740993",
    null,
    "9223372036854775807",
  ]);
  expect(() => resolveInputPreset("ListNode<bool>").parse("[true,null]")).toThrow();
  expect(resolveInputPreset("TreeNode<datetime>").accepts('"2024-05-01T00:00:00",null')).toBe(true);
});

it("uses Zod for editable numeric prefixes and complete type validation", () => {
  const number = inputPresetSchemas(resolveInputPreset("int"));
  expect(number.edit.safeParse("-").success).toBe(true);
  expect(number.edit.safeParse("12x").success).toBe(false);
  expect(number.value.safeParse("-").success).toBe(false);
  expect(number.value.safeParse("3/2").success).toBe(false);
  expect(number.value.safeParse("2*3").success).toBe(true);
  const text = inputPresetSchemas(resolveInputPreset("str"));
  expect(text.value.safeParse("  keep  spaces  ").success).toBe(true);
});

it("blocks invalid tree alphabet while keeping string payloads editable", () => {
  expect(resolveInputPreset("TreeNode").accepts("1 (2, null)")).toBe(true);
  expect(resolveInputPreset("TreeNode").accepts("1 (2, xyz)")).toBe(false);
  expect(resolveInputPreset("TreeNode<str>").accepts('"  keep  spaces  " ("你好", "text")')).toBe(
    true,
  );
});

it("guards datetime prefixes and exact long bounds", () => {
  const datetime = resolveInputPreset("datetime");
  for (const source of ["", "2026-1", "2026-11-05T12:"])
    expect(datetime.accepts(source)).toBe(true);
  for (const source of ["hello", "2026-13", "2026-02-29", "2026-11-05T25"])
    expect(datetime.accepts(source)).toBe(false);
  const long = resolveInputPreset("long");
  expect(long.accepts("-")).toBe(true);
  expect(long.accepts("9223372036854775807")).toBe(true);
  expect(long.accepts("9223372036854775808")).toBe(false);
});
