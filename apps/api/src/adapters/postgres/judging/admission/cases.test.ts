import { describe, expect, it } from "vitest";
import { storeCases } from "./cases.ts";

describe("admission case storage", () => {
  it("retains arbitrary numeric lexemes and NUL in the authoritative sidecar", () => {
    const raw = '[{"args":[9007199254740993,"a\\u0000b"],"expected":1.0000000000000001}]';
    const result = storeCases(raw, true);
    expect(result.json).toContain("9007199254740993");
    expect(result.json).toContain("1.0000000000000001");
    expect(result.json).not.toContain("\\u0000");
    expect(new TextDecoder().decode(result.lossless!)).toBe(raw);
    expect(() => storeCases(raw, false)).toThrow("temporarily unavailable");
  });
  it("leaves ordinary cases without a sidecar", () => {
    expect(storeCases('[{"args":[1],"expected":2}]', false).lossless).toBeNull();
    expect(() => storeCases("{}", true)).toThrow("Invalid execution cases");
  });
});
