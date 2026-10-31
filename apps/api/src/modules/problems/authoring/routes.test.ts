import { expect, it } from "vitest";
import { createApp } from "../../../app.ts";
import { IdentityError, type Principal } from "../../identity/model.ts";
import { authoringRoutes } from "./routes.ts";
import type { QuestionAuthoring } from "./ports.ts";
const principal: Principal = {
  kind: "local",
  userId: "owner",
  displayName: "Owner",
  admin: true,
  emailVerified: true,
  sessionId: "session",
  strongUntil: 0,
};
it("requires identity, validates input and enforces global step-up through shared HTTP errors", async () => {
  let called = 0;
  const service: QuestionAuthoring = {
    list: async () => '{"items":[]}',
    get: async () => '{"id":"draft"}',
    create: async (_actor, raw) => {
      called++;
      return raw ?? "{}";
    },
    update: async () => "{}",
    publish: async () => {
      called++;
      return "{}";
    },
  };
  let identity: Principal | undefined = principal;
  let fail = false;
  const app = createApp({ allowedOrigins: [], requestId: () => "req" }).route(
    "/",
    authoringRoutes({
      identify: async () => {
        if (fail) throw new IdentityError("unauthorized");
        return identity;
      },
      authoring: service,
      allowLocalStrongBypass: false,
      now: () => 100,
    }),
  );
  const id = "00000000-0000-4000-8000-000000000001";
  let response = await app.request(`/v1/admin/question-drafts/${id}/publish`, {
    method: "POST",
    body: '{"revision":"1","visibility":"global"}',
  });
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    error: { code: "step_up_required", requestId: "req" },
  });
  expect(called).toBe(0);
  response = await app.request("/v1/admin/question-drafts", {
    method: "POST",
    headers: { "X-Admin": "true", "X-Quorem-Owner": "victim" },
    body: '{"content":{"problem":{},"hiddenCases":[{"args":[1e309]}]}}',
  });
  expect(response.status).toBe(201);
  expect(await response.text()).toContain("1e309");
  response = await app.request("/v1/admin/question-drafts", {
    method: "POST",
    body: '{"content":{},"role":"admin"}',
  });
  expect(response.status).toBe(400);
  identity = undefined;
  response = await app.request("/v1/admin/question-drafts");
  expect(response.status).toBe(401);
  fail = true;
  response = await app.request("/v1/admin/question-drafts");
  expect(response.status).toBe(401);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});
