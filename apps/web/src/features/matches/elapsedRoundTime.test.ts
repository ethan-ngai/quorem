import { describe, expect, it } from "vitest";
import { elapsedRoundTime } from "./MatchEndView";

describe("elapsed round time", () => {
  it("uses actual start and completion timestamps", () => {
    expect(elapsedRoundTime("2026-01-01T00:00:00Z", "2026-01-01T00:08:42Z")).toBe("8:42");
    expect(elapsedRoundTime("2026-01-01T00:00:00Z", "2026-01-01T01:02:03Z")).toBe("1:02:03");
  });
  it("omits missing, invalid, or reversed timestamps", () => {
    expect(elapsedRoundTime()).toBeUndefined();
    expect(elapsedRoundTime("invalid", "2026-01-01T00:00:00Z")).toBeUndefined();
    expect(elapsedRoundTime("2026-01-02T00:00:00Z", "2026-01-01T00:00:00Z")).toBeUndefined();
  });
});
