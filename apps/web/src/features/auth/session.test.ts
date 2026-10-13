import { afterEach, describe, expect, it, vi } from "vitest";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
describe("account identity transport", () => {
  it("anonymous requests never fall back to a fixture account", async () => {
    vi.stubGlobal("window", { location: { origin: "http://127.0.0.1:5174" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: string | Request) => {
        if (typeof request === "string") return new Response("{}", { status: 401 });
        expect(request.headers.get("X-Dev-User")).toBeNull();
        expect(request.headers.get("Authorization")).toBeNull();
        return new Response("{}", { status: 401 });
      }),
    );
    const { fetchSession, authenticatedFetch } = await import("./session");
    expect(await fetchSession()).toBeNull();
    await authenticatedFetch(
      new Request("http://127.0.0.1:5174/v1/session", { headers: { "X-Dev-User": "alice" } }),
    );
  });
  it("verified application bearer removes fixture headers", async () => {
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
    expect((await fetchSession())?.user.id).toBe("immutable");
  });
  it("password sign in submits cookie credentials then reloads the authenticated application", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { assign });
    const fetch = vi.fn(async () => Response.json({ user: { id: "real-user" } }));
    vi.stubGlobal("fetch", fetch);
    const { signInWithPassword } = await import("./session");
    await signInWithPassword("alice", "example-password");
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/sign-in/username",
      expect.objectContaining({
        credentials: "same-origin",
        method: "POST",
        body: JSON.stringify({ username: "alice", password: "example-password" }),
      }),
    );
    expect(assign).toHaveBeenCalledWith("/practice");
  });
  it("bad passwords do not navigate and show an actionable error", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { assign });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 })),
    );
    const { signInWithPassword } = await import("./session");
    await expect(signInWithPassword("alice", "wrong")).rejects.toThrow(
      "Incorrect username or password",
    );
    expect(assign).not.toHaveBeenCalled();
  });
  it("rejects unknown auth configuration rather than exposing a credential form", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ method: "unknown" })),
    );
    const { authMethod } = await import("./session");
    await expect(authMethod()).rejects.toThrow("Sign in unavailable");
  });
  it("a token request started before logout cannot restore the previous bearer", async () => {
    let finishToken: ((response: Response) => void) | undefined;
    let tokenRequests = 0;
    vi.stubGlobal("location", { assign: vi.fn() });
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string) => {
        if (path === "/api/auth/sign-out") return Promise.resolve(Response.json({ success: true }));
        tokenRequests++;
        if (tokenRequests === 1)
          return new Promise<Response>((resolve) => {
            finishToken = resolve;
          });
        return Promise.resolve(new Response("{}", { status: 401 }));
      }),
    );
    const { token, signOut } = await import("./session");
    const previous = token();
    await signOut();
    finishToken!(Response.json({ token: "revoked-bearer" }));
    expect(await previous).toBeUndefined();
    expect(await token()).toBeUndefined();
    expect(tokenRequests).toBe(2);
  });
  it("returns to local work after login without accepting external destinations", async () => {
    const { signInDestination } = await import("./session");
    expect(signInDestination("?returnTo=%2Fpractice%2Frun-widths")).toBe("/practice/run-widths");
    for (const destination of [
      "https://example.com",
      "//example.com",
      "/login",
      "/practice\\example.com",
    ]) {
      expect(signInDestination(`?returnTo=${encodeURIComponent(destination)}`)).toBe("/practice");
    }
  });
});
