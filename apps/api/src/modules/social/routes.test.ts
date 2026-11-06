/** @file routes.test.ts @description Social transport admission and input boundaries. @module social */
import { expect, it, vi } from "vitest";
import { createApp } from "../../app.ts";
import type { Principal } from "../identity/model.ts";
import { socialRoutes } from "./routes.ts";
const actor: Principal = {
  kind: "local",
  userId: "viewer",
  displayName: "Viewer",
  admin: false,
  emailVerified: true,
  sessionId: "session",
  strongUntil: 0,
};
const id = "00000000-0000-4000-8000-000000000001";
function fixture(who: Principal | undefined) {
  const social = {
    overview: vi.fn().mockResolvedValue({}),
    players: vi.fn().mockResolvedValue({}),
    profile: vi.fn().mockResolvedValue({}),
  };
  const app = createApp({ allowedOrigins: [], requestId: () => "social-test" }).route(
    "/",
    socialRoutes({ identify: async () => who, social }),
  );
  return { app, social };
}
it("denies anonymous and guest reads on every social endpoint", async () => {
  const guest: Principal = {
    ...actor,
    kind: "guest",
    admin: false,
    emailVerified: false,
    strongUntil: 0,
    credentialExpiresAt: 9999999999,
    scope: { kind: "match", matchId: id },
  };
  for (const who of [null, guest]) {
    const { app, social } = fixture(who ?? undefined);
    for (const path of ["/v1/social", "/v1/players", `/v1/players/${id}`])
      expect((await app.request(path)).status).toBe(who ? 403 : 401);
    for (const method of Object.values(social)) expect(method).not.toHaveBeenCalled();
  }
});
it("validates search, offsets and public IDs before reading", async () => {
  const { app, social } = fixture(actor);
  for (const path of [
    "/v1/players?offset=-1",
    "/v1/players?offset=1.5",
    "/v1/players?offset=10001",
    `/v1/players?q=${"a".repeat(81)}`,
    "/v1/players/internal-owner",
  ])
    expect((await app.request(path)).status).toBe(400);
  expect(social.players).not.toHaveBeenCalled();
  expect(social.profile).not.toHaveBeenCalled();
  const response = await app.request("/v1/players?q=%20Alice%20&offset=20");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(social.players).toHaveBeenCalledWith("viewer", "Alice", 20);
  await app.request(`/v1/players/${id}`);
  expect(social.profile).toHaveBeenCalledWith("viewer", id);
});
