import { expect, it } from "vitest";
import { IdentityError } from "./model.ts";
import { GuestOriginDenied } from "./guest/credentials.ts";
import { identifyRequest, mapIdentityError } from "./routes.ts";
it("maps identity failures consistently while retaining internal cause", async () => {
  for (const [cause, status] of [
    [new IdentityError("unauthorized"), 401],
    [new IdentityError("unavailable"), 503],
    [new GuestOriginDenied(), 403],
  ] as const) {
    expect(mapIdentityError(cause)).toMatchObject({ status, cause });
    await expect(
      identifyRequest(async () => {
        throw cause;
      }, new Request("https://example.test")),
    ).rejects.toMatchObject({ status, cause });
  }
});

import { createApp } from "../../app.ts";
import { identityRoutes } from "./routes.ts";
import type { Principal, GuestPrincipal } from "./model.ts";
const account: Principal = {
  kind: "local",
  userId: "owner",
  displayName: "Alice",
  admin: true,
  emailVerified: true,
  sessionId: "session",
  strongUntil: 123,
};
const guest: GuestPrincipal = {
  kind: "guest",
  userId: "guest",
  displayName: "Guest",
  admin: false,
  emailVerified: false,
  sessionId: "hash",
  strongUntil: 0,
  credentialExpiresAt: 9999999999,
  scope: { kind: "match", matchId: "match" },
};
const caps = {
  authorCustomQuestions: true,
  interviewConcurrency: 2,
  hostGuests: true,
  hostedIntelligence: false,
  experimental: false,
  interviews: true,
  guestConcurrency: 3,
};
function sessionApp(value: Principal | undefined, ended = false, unavailable = false) {
  let reads = 0;
  const app = createApp({ allowedOrigins: [], requestId: () => "request" }).route(
    "/",
    identityRoutes({
      identify: async () => value,
      capabilities: {
        capabilities: async () => {
          reads++;
          return caps;
        },
      },
      guests: {
        endMatch: async () => {
          if (unavailable) throw new Error("private database details");
          return ended;
        },
        lookup: async () => guest,
      },
    }),
  );
  return { app, reads: () => reads };
}
it("serves canonical account capabilities and session identity", async () => {
  const { app } = sessionApp(account);
  expect(await (await app.request("/v1/capabilities")).json()).toEqual(caps);
  const response = await app.request("/v1/session");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({
    kind: "account",
    mode: "development",
    strongUntil: 123,
    capabilities: caps,
    user: { id: "owner", role: "admin" },
  });
  expect((await sessionApp(undefined).app.request("/v1/session")).status).toBe(401);
});
it("reconciles guest session without granting account capabilities", async () => {
  const { app, reads } = sessionApp(guest);
  expect((await app.request("/v1/capabilities")).status).toBe(403);
  expect(await (await app.request("/v1/session")).json()).toMatchObject({
    kind: "guest",
    matchId: "match",
    capabilities: { hostGuests: false, interviewConcurrency: 0 },
  });
  expect(reads()).toBe(0);
  const ended = await sessionApp(guest, true).app.request("https://example.test/v1/session");
  expect(ended.status).toBe(401);
  expect(ended.headers.get("set-cookie")).toContain(
    "quorem_guest=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure",
  );
  const outage = await sessionApp(guest, false, true).app.request("/v1/session");
  expect(outage.status).toBe(503);
  expect(await outage.text()).not.toContain("private database");
});
