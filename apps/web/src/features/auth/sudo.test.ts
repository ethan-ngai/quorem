/** @file sudo.test.ts @description Deduplicated prompts, trusted expiry and cancellation. @module auth */
import { afterEach, expect, it, vi } from "vitest";
import { cancelSudo, completeSudo, requireSudo, sudoRequest, sudoSnapshot } from "./sudo";
const reset = vi.hoisted(() => vi.fn());
vi.mock("./session", () => ({ resetToken: reset }));
const status = {
  userId: "account",
  until: 0,
  methods: { password: true, passkey: false, email: true },
};
const response = (value: unknown, code = 200) =>
  new Response(JSON.stringify(value), { status: code });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
it("uses an existing server-owned sudo window without prompting", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response({ ...status, until: Date.now() / 1000 + 600 })),
  );
  await requireSudo();
  expect(sudoSnapshot()).toBeUndefined();
});
it("deduplicates concurrent protected operations and resumes after server confirmation", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(status))
    .mockResolvedValueOnce(response({ ...status, until: Date.now() / 1000 + 900 }));
  vi.stubGlobal("fetch", fetch);
  const first = requireSudo(),
    second = requireSudo();
  expect(first).toBe(second);
  await vi.waitFor(() => expect(sudoSnapshot()).toBeDefined());
  await completeSudo();
  await first;
  expect(reset).toHaveBeenCalledOnce();
  expect(sudoSnapshot()).toBeUndefined();
});
it("cancels without authorizing queued work", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response(status)),
  );
  const pending = requireSudo();
  const rejected = expect(pending).rejects.toThrow("Verification cancelled");
  await vi.waitFor(() => expect(sudoSnapshot()).toBeDefined());
  cancelSudo();
  await rejected;
});
it("rejects account changes and unconfirmed verification", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response(status))
    .mockResolvedValueOnce(response({ ...status, userId: "other", until: Date.now() / 1000 + 900 }))
    .mockResolvedValueOnce(response(status));
  vi.stubGlobal("fetch", fetch);
  const pending = requireSudo();
  const rejected = expect(pending).rejects.toThrow("Verification cancelled");
  await vi.waitFor(() => expect(sudoSnapshot()).toBeDefined());
  await expect(completeSudo()).rejects.toThrow("Account changed");
  await expect(completeSudo()).rejects.toThrow("could not be confirmed");
  cancelSudo();
  await rejected;
});
it("displays safe password, code and throttling errors", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response({}, 400))
    .mockResolvedValueOnce(response({}, 400))
    .mockResolvedValueOnce(response({}, 429));
  vi.stubGlobal("fetch", fetch);
  await expect(sudoRequest("password", { password: "fixture" })).rejects.toThrow(
    "Incorrect password",
  );
  await expect(sudoRequest("email-code", { code: "123456" })).rejects.toThrow(
    "Code expired or incorrect",
  );
  await expect(sudoRequest("send-code", {})).rejects.toThrow("Too many attempts");
});
