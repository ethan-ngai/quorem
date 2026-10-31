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
it("derives SQL sample expectations with exact decimals", () => {
  const sql = {
    dialect: "postgresql",
    outputOrder: "unordered",
    output: [{ name: "n", type: "numeric" }],
  };
  const spec: ExecutionSpec = {
    problemJson: JSON.stringify({ sql }),
    source: "",
    kind: "submit",
    cases: ['{"args":[],"expected":{"rows":[[{"$numeric":"999"}]]}}'],
    submitSamples: ['{"args":[],"expected":{"rows":[[{"$numeric":"1.00"}]]}}'],
    submitCasesAreSamples: false,
    privateDetails: true,
  };
  const result = deriveResult(spec, "sample", 0, "accepted", '{"rows":[[{"$numeric":"1"}]]}', [
    "numeric",
  ]);
  expect(result.status).toBe("accepted");
  expect(result.expected).toContain('"1"');
  expect(result.expected).not.toContain("999");
});
it("derives Odyssey call expectations from the admitted public sequence", () => {
  const signature = {
    className: "Solution",
    methodName: "clear",
    parameters: [],
    returnType: "void",
  };
  const spec: ExecutionSpec = {
    problemJson: JSON.stringify({ signature, odyssey: { levels: [{ methods: [signature] }] } }),
    source: "",
    kind: "submit",
    cases: ['{"args":[],"calls":[{"methodName":"clear","args":[]}]}'],
    submitSamples: ['{"args":[],"calls":[{"methodName":"clear","args":[]}]}'],
    submitCasesAreSamples: false,
    privateDetails: true,
  };
  expect(deriveResult(spec, "sample", 0, "executed", "[42]", [])).toEqual({
    status: "accepted",
    actual: "[null]",
    expected: "[null]",
  });
});
