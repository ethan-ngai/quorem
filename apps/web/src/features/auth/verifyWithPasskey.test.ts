/** @file verifyWithPasskey.test.ts @description In-place verification preserves account boundaries. @module auth */
import { afterEach, expect, it, vi } from "vitest";
import { verifyWithPasskey } from "./capabilities";

const mocks = vi.hoisted(() => ({ signIn: vi.fn(), session: vi.fn(), reset: vi.fn() }));
vi.mock("better-auth/client", () => ({
  createAuthClient: () => ({ signIn: { passkey: mocks.signIn } }),
}));
vi.mock("@better-auth/passkey/client", () => ({ passkeyClient: () => ({}) }));
vi.mock("./session", () => ({
  fetchSession: mocks.session,
  resetToken: mocks.reset,
  signInDestination: () => "/practice",
}));
vi.mock("./avatarCache", () => ({ invalidateAvatarHints: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
function setup() {
  vi.stubGlobal("window", { isSecureContext: true });
  vi.stubGlobal("PublicKeyCredential", class {});
  const assign = vi.fn();
  vi.stubGlobal("location", { assign });
  mocks.signIn.mockResolvedValue({ data: {} });
  return assign;
}
it("refreshes the token without navigating away from the protected action", async () => {
  const assign = setup();
  mocks.session.mockResolvedValue({ user: { id: "same" } });
  await verifyWithPasskey();
  expect(mocks.reset).toHaveBeenCalledTimes(1);
  expect(assign).not.toHaveBeenCalled();
});
it("blocks resuming an operation under a different account", async () => {
  setup();
  mocks.session
    .mockResolvedValueOnce({ user: { id: "first" } })
    .mockResolvedValueOnce({ user: { id: "second" } });
  await expect(verifyWithPasskey()).rejects.toThrow("Account changed");
});
it("requires a signed-in account before opening the passkey prompt", async () => {
  setup();
  mocks.session.mockResolvedValue(null);
  await expect(verifyWithPasskey()).rejects.toThrow("Sign in again");
  expect(mocks.signIn).not.toHaveBeenCalled();
});
