import { UserFacingError as AuthError } from "../../ui/errors";
export {
  UserFacingError as AuthError,
  userFacingErrorMessage as authErrorMessage,
} from "../../ui/errors";

export function passkeyError(error: unknown): AuthError {
  const detail =
    error && typeof error === "object" ? (error as { name?: string; code?: string }) : {};
  if (
    ["NotAllowedError", "AbortError"].includes(detail.name ?? "") ||
    ["AUTH_CANCELLED", "REGISTRATION_CANCELLED", "ERROR_CEREMONY_ABORTED"].includes(
      detail.code ?? "",
    )
  )
    return new AuthError("Passkey request cancelled or timed out. Try again when you’re ready.");
  if (detail.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED")
    return new AuthError("This passkey is already added. Try another device or passkey.");
  return new AuthError("Could not complete the passkey request. Please try again.");
}

// Exact local-service messages only; never display arbitrary response text.
const registrationMessages = new Set([
  "Too many attempts. Try again shortly.",
  "Could not send your email. Please try again.",
  "This setup link expired. Request a new email.",
  "This link is invalid. Request a new email.",
  "This link expired or was already used. Request a new email.",
  "Your setup session expired. Request a new email.",
  "Account setup changed in another tab. Open your email link again.",
  "Your account is ready. Sign in instead.",
  "That username is taken. Choose another.",
  "Could not finish setup. Please try again.",
]);
export function registrationError(message: unknown): AuthError {
  return new AuthError(
    typeof message === "string" && registrationMessages.has(message)
      ? message
      : "Account setup unavailable. Please try again.",
  );
}
