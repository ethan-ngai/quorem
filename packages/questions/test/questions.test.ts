import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  generateStarter,
  validQuestionType,
  validateConstraints,
  validateInputConfig,
  validateQuestionDraft,
  validateSignature,
} from "../src/index";
import type { QuestionContent, Signature } from "../src/model";

const vectors = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/migration/public/go-oracle.json", import.meta.url),
    "utf8",
  ),
) as {
  name: string;
  input: { signature: Signature; language: "python" | "java" | "typescript" | "ocaml" };
  output: string;
}[];
const signature: Signature = {
  className: "Solution",
  methodName: "sum",
  parameters: [{ name: "values", type: "list<int>" }],
  returnType: "int",
};

describe("starters", () => {
  for (const vector of vectors.filter((v) => v.name === "starter"))
    it(`matches Go ${vector.input.language}`, () => {
      expect(generateStarter([vector.input.signature], vector.input.language, false)).toBe(
        vector.output,
      );
    });
  it("escapes authored documentation and supports staged no-arg methods", () => {
    const sig: Signature = {
      ...signature,
      methodName: "clear",
      parameters: [],
      returnType: "void",
      description: '*/ *) """ \\',
      returns: "done",
    };
    expect(generateStarter([sig], "java", false)).not.toContain("Describe */");
    expect(generateStarter([sig], "java", false)).toContain("* /");
    expect(generateStarter([sig], "ocaml", true)).toContain("let clear () : unit");
    expect(generateStarter([sig], "python", false)).toContain('\\"\\"\\"');
    expect(generateStarter([], "postgresql", false)).toBe("-- Write your query here.\n");
    expect(() => generateStarter([], "python", false)).toThrow("method required");
  });
});

describe("signature and constraint metadata", () => {
  it("enforces type grammar, presets and output order", () => {
    expect(validQuestionType("optional<array<list<int>>>")).toBe(true);
    expect(validQuestionType("optional<int")).toBe(false);
    expect(() => validateInputConfig("optional<list<int>>", { preset: "sequence" })).not.toThrow();
    expect(() => validateInputConfig("list<int>", { preset: "matrix" })).toThrow();
    expect(() =>
      validateSignature({ ...signature, returnType: "int", outputOrder: "unordered" }),
    ).toThrow();
    expect(() => validateSignature({ ...signature, returnType: "void" }, true)).not.toThrow();
    expect(() => validateSignature({ ...signature, returnType: "void" })).toThrow();
  });
  it("validates ranges and projections", () => {
    expect(() =>
      validateConstraints(signature, [
        { kind: "range", target: { parameter: "values", projection: "elements" }, min: 0 },
      ]),
    ).not.toThrow();
    expect(() =>
      validateConstraints(signature, [
        { kind: "range", target: { parameter: "values", projection: "elements" }, min: 2, max: 1 },
      ]),
    ).toThrow("reversed bounds");
    expect(() =>
      validateConstraints(signature, [
        {
          kind: "property",
          target: { parameter: "values", projection: "length" },
          property: "unique",
        },
      ]),
    ).toThrow();
    expect(() =>
      validateConstraints(
        { ...signature, parameters: [...signature.parameters, signature.parameters[0]] },
        [],
      ),
    ).toThrow();
  });
});

describe("drafts", () => {
  const content: QuestionContent = {
    problem: {
      id: "",
      slug: "",
      version: "",
      title: "",
      difficulty: "easy",
      tags: [],
      statementMarkdown: "",
      examples: [],
      constraints: [],
      signature,
      limits: {
        wallTimeMs: 2000,
        memoryBytes: 268435456,
        outputBytes: 65536,
        maxProcesses: 16,
        maxCollectionElements: 10000,
        maxNestingDepth: 100,
      },
    },
    hiddenCases: [],
    attribution: "",
    implementations: [],
    solutions: [],
  };
  it("accepts incomplete drafts but rejects duplicate companies and NUL source", () => {
    expect(() => validateQuestionDraft(content)).not.toThrow();
    expect(() =>
      validateQuestionDraft({
        ...content,
        problem: { ...content.problem, companies: ["Acme", "acme"] },
      }),
    ).toThrow("duplicate company");
    expect(() =>
      validateQuestionDraft({
        ...content,
        implementations: [
          {
            language: "python",
            runtimeRevision: "r",
            harnessRevision: "h",
            starterSource: "a\0b",
            referenceSource: "x",
          },
        ],
      }),
    ).toThrow("NUL");
    expect(() =>
      validateQuestionDraft({
        ...content,
        problem: { ...content.problem, title: "😀".repeat(41) },
      }),
    ).toThrow("text limit");
  });
});
