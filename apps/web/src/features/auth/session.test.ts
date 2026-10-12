import { afterEach, describe, expect, it, vi } from "vitest";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
describe("account identity transport", () => {
  it("queries selected development account rather than default Alice", async () => {
    vi.stubGlobal("window", { location: { origin: "http://127.0.0.1:5174" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: string | Request) => {
        if (typeof request === "string") return new Response("{}", { status: 503 });
        const selected = request.headers.get("X-Dev-User");
        return Response.json({
          mode: "development",
          user: {
            id: selected,
            role: selected === "alice" ? "admin" : "user",
            displayName: selected,
            emailVerified: true,
          },
        });
      }),
    );
    const { fetchSession } = await import("./session");
    expect((await fetchSession("alice"))?.user.role).toBe("admin");
    expect((await fetchSession("bob"))?.user).toMatchObject({ id: "bob", role: "user" });
  });
  it("verified application bearer removes selected fixture header", async () => {
    vi.stubGlobal("window", { location: { origin: "http://127.0.0.1:5174" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: string | Request) => {
        if (typeof request === "string") return Response.json({ token: "server-issued-token" });
        expect(request.headers.get("X-Dev-User")).toBeNull();
        expect(request.headers.get("Authorization")).toBe("Bearer server-issued-token");
        return Response.json({
          mode: "managed",
          user: { id: "immutable", role: "user", emailVerified: true },
        });
      }),
    );
    const { fetchSession } = await import("./session");
    expect((await fetchSession("alice"))?.user.id).toBe("immutable");
  });
});
