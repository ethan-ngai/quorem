import { describe, expect, it } from "vitest";
import { requireData } from "./client";
import { UserFacingError, userFacingErrorMessage } from "../ui/errors";

describe("shared API responses", () => {
  it("returns valid falsy response data", () => {
    expect(requireData(false, undefined)).toBe(false);
    expect(requireData(0, undefined)).toBe(0);
    expect(requireData(null, undefined)).toBeNull();
  });
  it("uses contextual fallbacks for unknown or unsafe responses", () => {
    for (const error of [
      undefined,
      null,
      {},
      { error: null },
      { error: "bad" },
      { error: { code: "constructor", message: "private database details" } },
      { error: { code: "invalid_input", message: "private database details" } },
    ]) {
      try {
        requireData(undefined, error);
        throw new Error("expected failure");
      } catch (cause) {
        expect(cause).not.toBeInstanceOf(UserFacingError);
        expect(userFacingErrorMessage(cause, "Could not save the draft.")).toBe(
          "Could not save the draft.",
        );
      }
    }
  });
  it("explains reviewed errors without exposing untrusted details", () => {
    for (const [code, detail, expected] of [
      [
        "no_matching_questions",
        "private details",
        "No questions match these filters. Change the filters before starting.",
      ],
      [
        "invalid_transition",
        "All players must be ready",
        "Everyone must be ready before the match can start.",
      ],
      [
        "invalid_input",
        "LeetCode ID is already in use",
        "That LeetCode ID is already used by another question.",
      ],
      [
        "user_busy",
        "Another execution is active",
        "A run is already in progress. Wait for it to finish.",
      ],
      ["room_full", "internal", "This lobby is full."],
      ["entitlement_required", "private details", "This feature is not enabled for this account."],
    ])
      expect(() => requireData(undefined, { error: { code, message: detail } })).toThrow(expected);
  });
});
