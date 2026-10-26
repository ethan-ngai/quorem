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
  it("email credentials use the email endpoint without a username field", async () => {
    vi.stubGlobal("location", { assign: vi.fn() });
    const fetch = vi.fn(async () => Response.json({ user: { id: "real-user" } }));
    vi.stubGlobal("fetch", fetch);
    const { signInWithPassword } = await import("./session");
    await signInWithPassword("alice@example.test", "example-password");
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/sign-in/email",
      expect.objectContaining({
        body: JSON.stringify({ email: "alice@example.test", password: "example-password" }),
      }),
    );
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
      "Incorrect username, email or password",
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
    expect(signInDestination("?returnTo=%2Fpractice%3Fq%3Dtree")).toBe("/practice?q=tree");
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

describe("anonymous token polling", () => {
  it("caches missing account credentials until an explicit auth change", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(Response.json({ token: "signed-in" }));
    vi.stubGlobal("fetch", fetch);
    const { token, resetToken } = await import("./session");
    expect(await token()).toBeUndefined();
    expect(await token()).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    resetToken();
    expect(await token()).toBe("signed-in");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("session continuity", () => {
  it("does not turn a token-service outage into an anonymous session", async () => {
    vi.stubGlobal("window", { location: { origin: "http://localhost" } });
    const fetch = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    const { fetchSession } = await import("./session");
    await expect(fetchSession()).rejects.toThrow("Account temporarily unavailable");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("propagates token network failures without sending an unauthenticated request", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", fetch);
    const { authenticatedFetch } = await import("./session");
    await expect(authenticatedFetch("http://localhost/v1/session")).rejects.toThrow("offline");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("refreshes based on JWT expiry instead of assuming a fresh five-minute token", async () => {
    const now = Date.now();
    const jwt = (exp: number) => `header.${btoa(JSON.stringify({ exp }))}.signature`;
    const nearExpiry = jwt(Math.floor(now / 1000) + 20);
    const renewed = jwt(Math.floor(now / 1000) + 300);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ token: nearExpiry }))
      .mockResolvedValueOnce(Response.json({ token: renewed }));
    vi.stubGlobal("fetch", fetch);
    const { token, tokenExpiresAt } = await import("./session");
    expect(await token()).toBe(nearExpiry);
    expect(tokenExpiresAt()).toBe((Math.floor(now / 1000) + 20) * 1000);
    expect(await token()).toBe(renewed);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("retries an expired bearer once without changing a submission body or retry key", async () => {
    const requests: Request[] = [];
    let credentials = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | Request) => {
        if (typeof input === "string")
          return Response.json({ token: ++credentials === 1 ? "old" : "new" });
        requests.push(input);
        return requests.length === 1
          ? new Response(null, { status: 401 })
          : Response.json({ id: "submission" });
      }),
    );
    const { authenticatedFetch } = await import("./session");
    const response = await authenticatedFetch("http://localhost/v1/submissions", {
      method: "POST",
      headers: { "Idempotency-Key": "same-operation" },
      body: "source snapshot",
    });
    expect(response.ok).toBe(true);
    expect(requests.map((request) => request.headers.get("Authorization"))).toEqual([
      "Bearer old",
      "Bearer new",
    ]);
    for (const request of requests) {
      expect(request.headers.get("Idempotency-Key")).toBe("same-operation");
      expect(await request.text()).toBe("source snapshot");
    }
  });
});
