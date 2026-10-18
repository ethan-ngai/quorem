import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthError, authErrorMessage, passkeyError, registrationError } from "./errors";
import { accountRequest, AccountRateLimitError } from "./account";
import { registrationStatus } from "./capabilities";

const raw =
  "The operation either timed out or was not allowed. See: https://www.w3.org/TR/webauthn-2/#sctn-privacy-considerations-client.";
afterEach(() => vi.unstubAllGlobals());

describe("safe product error messages", () => {
  it.each([
    new Error(raw),
    new DOMException(raw, "NotAllowedError"),
    { message: raw },
    raw,
    undefined,
  ])("never renders untrusted error text: %s", (error) => {
    expect(authErrorMessage(error, "Please try again.")).toBe("Please try again.");
  });
  it("preserves explicitly approved messages", () => {
    expect(authErrorMessage(new AuthError("Choose a smaller photo."), "Failed")).toBe(
      "Choose a smaller photo.",
    );
  });
  it.each([
    { code: "AUTH_CANCELLED" },
    { code: "ERROR_CEREMONY_ABORTED" },
    new DOMException(raw, "NotAllowedError"),
    new DOMException(raw, "AbortError"),
  ])("explains passkey cancellation without browser details: %s", (error) => {
    expect(passkeyError(error).message).toBe(
      "Passkey request cancelled or timed out. Try again when you’re ready.",
    );
  });
  it("maps duplicate and unknown passkey failures without copying SDK messages", () => {
    expect(
      passkeyError({ code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED", message: raw }).message,
    ).toContain("already added");
    expect(passkeyError({ code: "UNKNOWN_ERROR", message: raw }).message).toBe(
      "Could not complete the passkey request. Please try again.",
    );
  });
  it("only accepts exact approved registration responses", () => {
    expect(registrationError("That username is taken. Choose another.").message).toContain(
      "username is taken",
    );
    expect(registrationError(raw).message).toBe("Account setup unavailable. Please try again.");
  });
  it("sanitizes registration service errors at the transport boundary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ message: raw }, { status: 500 })),
    );
    await expect(registrationStatus()).rejects.toThrow(
      "Account setup unavailable. Please try again.",
    );
  });
  it("sanitizes account errors while retaining retry timing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ message: raw }, { status: 429, headers: { "Retry-After": "42" } }),
      ),
    );
    try {
      await accountRequest("update-user", {});
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AccountRateLimitError);
      expect((error as AccountRateLimitError).retryAfter).toBe(42);
      expect(authErrorMessage(error, "Failed")).toBe("Too many attempts. Try again shortly.");
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ message: raw }, { status: 500 })),
    );
    await expect(accountRequest("update-user", {})).rejects.toThrow(
      "Account update unavailable. Please try again.",
    );
  });
});
