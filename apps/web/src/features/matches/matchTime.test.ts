import { describe, expect, it } from "vitest";
import { elapsedRoundSeconds, formatRoundTime } from "./matchTime";

describe("elapsed round time", () => {
  it("uses actual start and completion timestamps", () => {
    expect(elapsedRoundSeconds("2026-01-01T00:00:00Z", "2026-01-01T00:08:42Z")).toBe(522);
    expect(formatRoundTime(522)).toBe("8:42");
    expect(formatRoundTime(3723)).toBe("1:02:03");
  });
  it("omits missing, invalid, or reversed timestamps", () => {
    expect(elapsedRoundSeconds()).toBeUndefined();
    expect(elapsedRoundSeconds("invalid", "2026-01-01T00:00:00Z")).toBeUndefined();
    expect(elapsedRoundSeconds("2026-01-02T00:00:00Z", "2026-01-01T00:00:00Z")).toBeUndefined();
  });
});
