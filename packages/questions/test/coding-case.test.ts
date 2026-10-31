import { expect, it } from "vitest";
import { compareCodingCase, validateCodingCase, validateCodingSequence } from "../src/index.ts";
import type { Signature } from "../src/index.ts";

const sig: Signature = {
  className: "Solution",
  methodName: "solve",
  parameters: [
    { name: "values", type: "list<int>" },
    { name: "n", type: "int" },
  ],
  returnType: "list<int>",
  outputOrder: "unordered",
};
it("enforces constraints on decoded arguments", () => {
  const constraints = [
    {
      kind: "range" as const,
      target: { parameter: "values", projection: "elements" as const },
      min: 0,
    },
    {
      kind: "comparison" as const,
      left: { parameter: "n", projection: "value" as const },
      right: { parameter: "values", projection: "length" as const },
      operator: "le" as const,
    },
  ];
  expect(() =>
    validateCodingCase(sig, constraints, '{"args":[[1,2],2],"expected":[1,2]}'),
  ).not.toThrow();
  expect(() => validateCodingCase(sig, constraints, '{"args":[[1,-1],2],"expected":[1]}')).toThrow(
    "outside allowed range",
  );
  expect(() => validateCodingCase(sig, constraints, '{"args":[[1,2],3],"expected":[]}')).toThrow(
    "comparison",
  );
});
it("preserves duplicates and void results in comparisons", () => {
  expect(
    compareCodingCase(sig, [], '{"args":[[],0],"expected":[2,1,1]}', "executed", "[1,2,1]").status,
  ).toBe("accepted");
  expect(
    compareCodingCase(sig, [], '{"args":[[],0],"expected":[2,1,1]}', "executed", "[1,2]").status,
  ).toBe("wrong_answer");
  const clear: Signature = {
    className: "Solution",
    methodName: "clear",
    parameters: [],
    returnType: "void",
  };
  const data = '{"args":[],"calls":[{"methodName":"clear","args":[]}]}';
  expect(() => validateCodingSequence(clear, [], [clear], data)).not.toThrow();
  expect(compareCodingCase(clear, [clear], data, "executed", "[42]")).toEqual({
    status: "accepted",
    actual: "[null]",
    expected: "[null]",
  });
  expect(compareCodingCase(clear, [clear], data, "executed", "[]").status).toBe("invalid_output");
});
