/** @file errors.ts @description Safe creation failures and definitive rejection classification. @module matches */
import { UserFacingError } from "../../ui/errors";

const creationErrors: Record<string, string> = {
  user_busy:
    "You already have an active match. Return to it or leave its lobby before creating another.",
  invalid_input: "Choose valid match settings and try again.",
  not_found: "That problem is no longer available. Choose another problem.",
  unauthenticated: "Sign in again to create a match.",
  forbidden: "Your account cannot create this match.",
  quota_exceeded: "Match limit reached. Try again later.",
  rate_limited: "Too many attempts. Try again shortly.",
};

export class RejectedMatchCommand extends UserFacingError {}

/** Only recognized application rejections may discard a pending command. */
export function matchCreationError(error: unknown, status: number): Error {
  const detail = error && typeof error === "object" && "error" in error ? error.error : undefined;
  const code = detail && typeof detail === "object" && "code" in detail ? detail.code : undefined;
  const message =
    typeof code === "string" && Object.hasOwn(creationErrors, code)
      ? creationErrors[code]
      : undefined;
  return status >= 400 && status < 500 && message
    ? new RejectedMatchCommand(message)
    : new UserFacingError("Could not create match. Try again to safely retry your request.");
}
