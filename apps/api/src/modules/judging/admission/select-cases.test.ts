import { expect, it } from "vitest";
import type { QuestionProblem } from "@quorem/questions";
import { validateExecutionCases } from "./select-cases.ts";
const signature = {
  className: "Solution",
  methodName: "f",
  parameters: [{ name: "x", type: "int" }],
  returnType: "int",
};
const metadata = { signature, constraints: [] } as unknown as QuestionProblem;
it("validates custom values while preserving raw numeric input", () => {
  expect(() => validateExecutionCases(metadata, 0, ['{"args":[-0]}'])).not.toThrow();
  expect(() => validateExecutionCases(metadata, 0, ['{"args":["bad"]}'])).toThrow();
});
it("accepts omitted zero-argument lists as the Go decoder does", () => {
  const zero = {
    signature: { ...signature, parameters: [] },
    constraints: [],
  } as unknown as QuestionProblem;
  expect(() => validateExecutionCases(zero, 0, ['{"args":null}'])).not.toThrow();
});
