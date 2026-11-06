/** @file match-cutover.test.ts @description Public party cutover transport boundaries. @module runtime */
import { describe, expect, it } from "vitest";
import { createApp } from "../../app.ts";
import { matchLifecycleRoutes } from "../../modules/matches/lifecycle/routes.ts";
import { matchLanguageRoutes } from "../../modules/matches/selection/routes.ts";
import { matchReviewRoutes } from "../../modules/matches/review/routes.ts";
import type { Lifecycle } from "../../modules/matches/lifecycle/model.ts";
import { composeHttp, type HttpPorts } from "./http.ts";

const actor = {
  kind: "local" as const,
  userId: "owner",
  displayName: "Owner",
  admin: false,
  emailVerified: true,
  sessionId: "session",
  strongUntil: 0,
};
const identify = async () => actor;
const lifecycle: Lifecycle = {
  create: async () => {
    throw new Error("retired");
  },
  read: async (_who: unknown, id: string) => ({ id }),
  current: async () => ({ match: null }),
  mutate: async (_who: unknown, _id: string, _key: string, action: string) => ({ action }),
};

describe("party cutover", () => {
  it("does not mount the former match lobby API", async () => {
    const app = composeHttp({
      run: async () => {
        throw new Error("unexpected database access");
      },
      identify,
      origins: [],
      inviteKey: new Uint8Array(32),
      shards: 1,
      deadline: { wake: async () => {} },
      execution: { wake: async () => {} },
      guestCreation: false,
      guestAdmission: false,
      guestExecution: false,
    } as unknown as HttpPorts).app;
    for (const [method, path] of [
      ["POST", "/v1/matches"],
      ["POST", "/v1/matches/join"],
      ["GET", "/v1/match-invites/token"],
      ["POST", "/v1/match-invites/token/guest"],
      ["PUT", "/v1/matches/id/settings"],
      ["POST", "/v1/matches/id/ready"],
      ["POST", "/v1/matches/id/start"],
      ["POST", "/v1/matches/id/rotate-invite"],
      ["POST", "/v1/matches/id/guests/guest/remove"],
    ])
      expect((await app.request(path, { method })).status, `${method} ${path}`).toBe(404);
  });
  it("keeps active round reads, actions, language and review", async () => {
    const app = createApp({ allowedOrigins: [], requestId: () => "cutover" })
      .route("/", matchLifecycleRoutes({ identify, lifecycle }))
      .route(
        "/",
        matchLanguageRoutes({
          identify,
          language: { switchLanguage: async () => ({ language: "java" }) },
        }),
      )
      .route("/", matchReviewRoutes({ identify, review: { read: async () => '{"ok":true}' } }));
    expect((await app.request("/v1/matches/current")).status).toBe(200);
    expect((await app.request("/v1/matches/id")).status).toBe(200);
    expect((await app.request("/v1/matches/id/review")).status).toBe(200);
    for (const [path, body] of [
      ["forfeit", {}],
      ["leave", {}],
      ["rule-events", { kind: "focus" }],
      ["workspace-language", { language: "java" }],
    ] as const) {
      const result = await app.request(`/v1/matches/id/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "key" },
        body: JSON.stringify(body),
      });
      expect(result.status, path).toBe(200);
    }
  });
});
