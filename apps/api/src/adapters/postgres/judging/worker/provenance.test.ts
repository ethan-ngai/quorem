import { expect, it } from "vitest";
import { deriveResult } from "./provenance.ts";
import type { ExecutionSpec } from "@quorem/execution";
it("derives public expectations and status from admitted examples", () => {
  const spec: ExecutionSpec = {
    problemJson: JSON.stringify({
      signature: { className: "Solution", methodName: "f", parameters: [], returnType: "int" },
    }),
    source: "",
    kind: "submit",
    cases: ['{"args":[],"expected":987655}'],
    submitSamples: ['{"args":[],"expected":2}'],
    submitCasesAreSamples: false,
    privateDetails: true,
  };
  expect(deriveResult(spec, "sample", 0, "accepted", "2", [])).toEqual({
    status: "accepted",
    actual: "2",
    expected: "2",
  });
  expect(deriveResult(spec, "sample", 0, "accepted", "987655", [])).toEqual({
    status: "wrong_answer",
    actual: "987655",
    expected: "2",
  });
  expect(deriveResult(spec, "private", 0, "accepted", "987655", [])).toEqual({
    status: "accepted",
    actual: "987655",
    expected: "987655",
  });
  expect(() => deriveResult(spec, "public", 0, "accepted", "987655", [])).toThrow("channel");
});
