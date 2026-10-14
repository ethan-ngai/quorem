import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAuthCapabilities } from "./capabilities";
afterEach(() => vi.unstubAllGlobals());
describe("advertised authentication capabilities", () => {
  it("accepts only configured providers and a same-port localhost canonical origin", async () => {
    vi.stubGlobal("location", { origin: "http://127.0.0.1:5180" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          method: "password",
          preferredOrigin: "http://localhost:5180",
          passkey: true,
          registration: false,
          providers: ["google", "fake"],
        }),
      ),
    );
    expect(await fetchAuthCapabilities()).toEqual({
      method: "password",
      preferredOrigin: "http://localhost:5180",
      passkey: true,
      registration: false,
      providers: ["google"],
    });
  });
  it("never redirects credentials to a remote or different-port origin", async () => {
    vi.stubGlobal("location", { origin: "http://127.0.0.1:5180" });
    for (const preferredOrigin of [
      "https://evil.example",
      "http://localhost:8082",
      "http://localhost:5180/path",
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ method: "password", preferredOrigin })),
      );
      await expect(fetchAuthCapabilities()).rejects.toThrow("Sign in unavailable");
    }
  });
  it("defaults missing capabilities to unavailable and rejects service failure", async () => {
    vi.stubGlobal("location", { origin: "https://quorem.example" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ method: "cognito" })),
    );
    expect(await fetchAuthCapabilities()).toEqual({
      method: "cognito",
      preferredOrigin: "https://quorem.example",
      passkey: false,
      registration: false,
      providers: [],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    await expect(fetchAuthCapabilities()).rejects.toThrow("Sign in unavailable");
  });
});
