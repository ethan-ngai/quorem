import { afterEach, expect, it, vi } from "vitest";

vi.mock("./session", () => ({
  useSession: () => ({}),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("starts the profile read early and reuses it for the matching account", async () => {
  let finish!: (response: Response) => void;
  const fetch = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const { primeProfile, profileForCurrentAccount } = await import("./profile");
  primeProfile();
  expect(fetch).toHaveBeenCalledTimes(1);
  const profile = profileForCurrentAccount("account-a");
  finish(Response.json({ id: "account-a", name: "Alice", email: "a@example.test" }));
  expect((await profile).name).toBe("Alice");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("discards a speculative profile from another account", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ id: "account-b", name: "Bob" }))
    .mockResolvedValueOnce(Response.json({ id: "account-a", name: "Alice" }));
  vi.stubGlobal("fetch", fetch);
  const { primeProfile, profileForCurrentAccount } = await import("./profile");
  primeProfile();
  expect((await profileForCurrentAccount("account-a")).name).toBe("Alice");
  expect(fetch).toHaveBeenCalledTimes(2);
  fetch.mockImplementation(async () => Response.json({ id: "account-b", name: "Bob" }));
  await expect(profileForCurrentAccount("account-a")).rejects.toThrow("Account changed");
});
