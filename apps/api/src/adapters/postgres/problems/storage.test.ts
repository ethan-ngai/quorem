import { expect, it } from "vitest";
import { caseStorageProjection, storageProjection } from "./storage.ts";
it("preserves case NUL and numeric lexemes in authoritative sidecars", () => {
  const cases = '[{"args":["a\\u0000b",1e+30,9007199254740993],"expected":-0}]';
  const stored = caseStorageProjection(cases);
  expect(stored.safe).not.toContain("\\u0000");
  expect(new TextDecoder().decode(stored.lossless!)).toBe(cases);
  expect(caseStorageProjection('[{"args":[1],"expected":2}]').lossless).toBeNull();
  const fixture = '{"problem":{"examples":[{"args":["a\\u0000b"]}]},"hiddenCases":[]}';
  expect(new TextDecoder().decode(storageProjection(fixture).lossless!)).toBe(fixture);
});
