import { expect, it } from "vitest";
import { selectExecutionCases } from "./select-cases.ts";
const fixture = JSON.stringify({
  problem: {
    signature: {
      className: "Solution",
      methodName: "f",
      parameters: [{ name: "x", type: "int" }],
      returnType: "int",
    },
    constraints: [],
    examples: [{ args: [1], expected: 2, explanation: "public" }],
  },
  hiddenCases: [{ args: [3], expected: 4 }],
  odysseyHiddenCases: [],
});
it("separates public run cases from private submit cases and validates custom input", () => {
  expect(JSON.parse(selectExecutionCases(fixture, "run", 0, null))).toEqual([
    { args: [1], expected: 2 },
  ]);
  expect(JSON.parse(selectExecutionCases(fixture, "submit", 0, null))).toEqual([
    { args: [3], expected: 4 },
  ]);
  expect(JSON.parse(selectExecutionCases(fixture, "run", 0, ['{"args":[5]}']))).toEqual([
    { args: [5] },
  ]);
  expect(() => selectExecutionCases(fixture, "run", 0, ['{"args":["bad"]}'])).toThrow();
});
