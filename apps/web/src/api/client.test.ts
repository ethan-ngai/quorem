import { describe, expect, it } from "vitest";
import { requireData } from "./client";
import { UserFacingError } from "../ui/errors";

describe("shared API responses", () => {
  it("returns valid falsy response data", () => {
    expect(requireData(false, undefined)).toBe(false);
    expect(requireData(0, undefined)).toBe(0);
    expect(requireData(null, undefined)).toBeNull();
  });

  it("handles malformed errors and never exposes service details", () => {
    for (const error of [
      undefined,
      null,
      {},
      { error: null },
      { error: "bad" },
      { error: { code: "constructor", message: "private database details" } },
      { error: { code: "internal", message: "private database details" } },
    ]) {
      expect(() => requireData(undefined, error)).toThrow(UserFacingError);
      expect(() => requireData(undefined, error)).toThrow("Request failed. Please try again.");
    }
  });

  it("uses approved recovery messages for recognized errors", () => {
    expect(() =>
      requireData(undefined, { error: { code: "room_full", message: "internal" } }),
    ).toThrow("This lobby is full.");
  });
});
