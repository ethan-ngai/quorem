import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchProfile, uploadProfilePhoto, removeProfilePhoto, photoSizeLimit } from "./profile";
afterEach(() => vi.unstubAllGlobals());
describe("profile photo transport", () => {
  it("reads the signed-in profile with same-origin cookies", async () => {
    const account = { name: "Alice", email: "alice@example.test", username: "alice", image: null };
    const fetch = vi.fn(async () => Response.json(account));
    vi.stubGlobal("fetch", fetch);
    expect(await fetchProfile()).toEqual(account);
    expect(fetch).toHaveBeenCalledWith("/api/auth/profile", { credentials: "same-origin" });
  });
  it("uploads original bytes and uses the server-issued photo URL", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "photo.webp", { type: "image/webp" });
    const account = {
      name: "Alice",
      email: "alice@example.test",
      image: "/api/auth/profile-photos/new-id",
    };
    const fetch = vi.fn(async () => Response.json(account));
    vi.stubGlobal("fetch", fetch);
    expect(await uploadProfilePhoto(file)).toEqual(account);
    expect(fetch).toHaveBeenCalledWith("/api/auth/profile-photo", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "image/webp" },
      body: file,
    });
  });
  it("removes the stored photo using the cookie-authenticated endpoint", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ name: "Alice", email: "alice@example.test", image: null }),
    );
    vi.stubGlobal("fetch", fetch);
    expect((await removeProfilePhoto()).image).toBeNull();
    expect(fetch).toHaveBeenCalledWith("/api/auth/profile-photo", {
      method: "DELETE",
      credentials: "same-origin",
    });
  });
  it("rejects unsupported, empty and oversized files before networking", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      uploadProfilePhoto(new File(["x"], "pic.svg", { type: "image/svg+xml" })),
    ).rejects.toThrow("JPEG, PNG, or WebP");
    await expect(
      uploadProfilePhoto(new File([], "empty.png", { type: "image/png" })),
    ).rejects.toThrow("smaller than 5 MB");
    await expect(
      uploadProfilePhoto(
        new File([new Uint8Array(photoSizeLimit + 1)], "large.png", { type: "image/png" }),
      ),
    ).rejects.toThrow("smaller than 5 MB");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    [401, "Sign in again"],
    [400, "valid JPEG"],
    [413, "smaller than 5 MB"],
    [429, "Try again shortly"],
    [503, "Try again"],
  ])("reports server %s without claiming an update", async (status, message) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status })),
    );
    await expect(removeProfilePhoto()).rejects.toThrow(message);
  });
});
