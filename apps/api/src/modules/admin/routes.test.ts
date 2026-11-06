/** @file routes.test.ts @description Administrator overview transport authority checks. @module admin */
import { expect, it, vi } from "vitest";
import { createApp } from "../../app.ts";
import { IdentityError, type Principal } from "../identity/model.ts";
import { adminRoutes } from "./routes.ts";

const admin: Principal = {
  kind: "local",
  userId: "admin",
  displayName: "Admin",
  admin: true,
  emailVerified: true,
  sessionId: "session",
  strongUntil: 0,
};

it("rejects anonymous, guest and member reads before querying aggregates", async () => {
  for (const [actor, status] of [
    [undefined, 401],
    [{ ...admin, admin: false }, 403],
    [
      {
        ...admin,
        kind: "guest",
        admin: false,
        emailVerified: false,
        strongUntil: 0,
        credentialExpiresAt: 9999999999,
        scope: { kind: "match", matchId: "match" },
      },
      403,
    ],
  ] as const) {
    const overview = vi.fn();
    const app = createApp({ allowedOrigins: [], requestId: () => "test" }).route(
      "/",
      adminRoutes({ identify: async () => actor, overview: { overview } }),
    );
    expect((await app.request("/v1/admin/overview")).status).toBe(status);
    expect(overview).not.toHaveBeenCalled();
  }
});

it("passes the verified administrator to the authority-rechecking reader", async () => {
  const overview = vi.fn().mockResolvedValue({ generatedAt: "2026-11-05T00:00:00Z" });
  const app = createApp({ allowedOrigins: [], requestId: () => "test" }).route(
    "/",
    adminRoutes({ identify: async () => admin, overview: { overview } }),
  );
  const response = await app.request("/v1/admin/overview");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(overview).toHaveBeenCalledWith("admin");
});

it("maps identity outages without exposing internal details", async () => {
  const app = createApp({ allowedOrigins: [], requestId: () => "test" }).route(
    "/",
    adminRoutes({
      identify: async () => {
        throw new IdentityError("unavailable", new Error("private"));
      },
      overview: { overview: vi.fn() },
    }),
  );
  const response = await app.request("/v1/admin/overview");
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private");
});
