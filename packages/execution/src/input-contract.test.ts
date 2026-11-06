/** @file input-contract.test.ts @description Untrusted execution input decoding tests. @module execution */
import { describe, expect, it } from "vitest";
import { decodeInputCaseRef, decodeInputManifest } from "./input-contract.ts";

const blob = { hash: "a".repeat(64), size: 0 };
const manifest = {
  kind: "submit",
  level: null,
  caseCount: 1,
  sampleCount: 1,
  privateDetails: true,
  submitCasesAreSamples: true,
  suiteHash: "b".repeat(64),
  source: blob,
  metadata: blob,
};

describe("input contract", () => {
  it("accepts valid manifests and references", () => {
    expect(decodeInputManifest(manifest)).toEqual(manifest);
    expect(decodeInputCaseRef({ ...blob, channel: "private" }).channel).toBe("private");
  });
  it("rejects malformed or inconsistent untrusted values", () => {
    for (const value of [
      null,
      {},
      { ...manifest, kind: "run" },
      { ...manifest, submitCasesAreSamples: false, kind: "run" },
      { ...manifest, caseCount: 2147483648, submitCasesAreSamples: false },
      { ...manifest, source: { ...blob, size: -1 } },
      { ...manifest, suiteHash: 4 },
    ])
      expect(() => decodeInputManifest(value)).toThrow();
    for (const value of [
      null,
      { ...blob, channel: "other" },
      { ...blob, hash: "bad", channel: "public" },
    ])
      expect(() => decodeInputCaseRef(value)).toThrow();
  });
});
