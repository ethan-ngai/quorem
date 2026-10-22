import { afterEach, expect, it, vi } from "vitest";
import { addPasskey, signInWithPasskey } from "./capabilities";
import { authErrorMessage } from "./errors";

const mocks = vi.hoisted(() => ({ enroll: vi.fn(), signIn: vi.fn() }));
vi.mock("better-auth/client", () => ({
  createAuthClient: () => ({
    signIn: { passkey: mocks.signIn },
    passkey: { addPasskey: mocks.enroll },
  }),
}));
vi.mock("@better-auth/passkey/client", () => ({ passkeyClient: () => ({}) }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it.each(["returned", "thrown"])(
  "sanitizes %s enrollment cancellation through the SDK boundary",
  async (mode) => {
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("PublicKeyCredential", class {});
    const error = new DOMException(
      "Internal browser details https://www.w3.org/private",
      "NotAllowedError",
    );
    if (mode === "thrown") mocks.enroll.mockRejectedValue(error);
    else
      mocks.enroll.mockResolvedValue({
        error: { code: "ERROR_CEREMONY_ABORTED", message: error.message },
      });
    await expect(addPasskey()).rejects.toThrow("Passkey request cancelled or timed out.");
  },
);

it("sanitizes unknown SDK errors and never navigates after failed sign-in", async () => {
  vi.stubGlobal("window", { isSecureContext: true });
  vi.stubGlobal("PublicKeyCredential", class {});
  const assign = vi.fn();
  vi.stubGlobal("location", { assign });
  mocks.signIn.mockResolvedValue({
    error: { code: "UNKNOWN_ERROR", message: "private service details" },
  });
  try {
    await signInWithPasskey();
    expect.unreachable();
  } catch (error) {
    expect(authErrorMessage(error, "Fallback")).toBe(
      "Could not complete the passkey request. Please try again.",
    );
  }
  expect(assign).not.toHaveBeenCalled();
});
