import { describe, expect, it, vi } from "vitest";
import { hostedSignIn } from "./hosted-sign-in";

describe("hosted sign-in", () => {
  it("maps the public route to the configured upstream while preserving request context", async () => {
    const handler = vi.fn(async (request: Request) => {
      expect(new URL(request.url).pathname).toBe("/api/auth/sign-in/social");
      expect(request.headers.get("origin")).toBe("https://quorem.test");
      expect(await request.json()).toEqual({ provider: "cognito", callbackURL: "/practice" });
      return Response.json({ url: "https://identity.example" });
    });
    const request = new Request("https://quorem.test/api/auth/sign-in/hosted", {
      method: "POST",
      headers: { origin: "https://quorem.test" },
      body: JSON.stringify({ provider: "attacker", callbackURL: "/practice" }),
    });
    expect((await hostedSignIn(request, "cognito", handler)).status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });
  it("rejects hosted login when unavailable or malformed", async () => {
    const request = () =>
      new Request("https://quorem.test/api/auth/sign-in/hosted", { method: "POST", body: "{" });
    const handler = vi.fn();
    expect((await hostedSignIn(request(), "password", handler)).status).toBe(404);
    expect((await hostedSignIn(request(), "cognito", handler)).status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });
});
