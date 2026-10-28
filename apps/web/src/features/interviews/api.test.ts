import { describe, expect, it } from "vitest";
import { userFacingErrorMessage } from "../../ui/errors";
import { InterviewError } from "./api";

describe("interview errors", () => {
  it("distinguishes interview limits and hides unknown server details", () => {
    expect(new InterviewError("quota_exceeded", 429, "Too many editor windows").message).toBe(
      "Close another editor window and try again.",
    );
    expect(new InterviewError("quota_exceeded", 429, "Guest admission limit reached").message).toBe(
      "This interview has reached its guest admission limit.",
    );
    expect(new InterviewError("quota_exceeded", 429, "private details").message).toBe(
      "A limit has been reached. Please try again later.",
    );
    expect(
      new InterviewError("entitlement_required", 403, "Interview access is disabled").message,
    ).toBe("The host's interview access is no longer enabled.");
  });
});

it("uses the action's fallback for an unknown failure", () => {
  const error = new InterviewError("internal", 500, "database details");
  expect(userFacingErrorMessage(error, "Could not join the interview. Try again.")).toBe(
    "Could not join the interview. Try again.",
  );
});
