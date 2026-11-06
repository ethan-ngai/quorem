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
    mutateBatch: async () => '{"items":[]}',
    publications: async () => '{"items":[]}',
    list: async () => '{"items":[]}',
    get: async () => '{"id":"draft"}',
    create: async (_actor, raw) => {
      called++;
      return raw ?? "{}";
    },
    importDraft: async (_actor, raw) => raw,
    importDraftBatch: async () => '{"items":[]}',
    update: async () => "{}",
    deleteDraft: async () => '{"deleted":true}',
    deletionImpact: async () => "{}",
    deletePublication: async () => "{}",
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

it("validates bounded mutation batches and forwards server-owned step-up state", async () => {
  const calls: unknown[] = [];
  let identity: Principal | undefined = principal;
  const app = createApp({ allowedOrigins: [], requestId: () => "batch" }).route(
    "/",
    authoringRoutes({
      identify: async () => identity,
      authoring: {
        mutateBatch: async (actor, batch) => {
          calls.push({ actor, batch });
          return JSON.stringify({
            items: batch.items.map(({ id }) => ({ id, status: "succeeded" })),
          });
        },
      } as QuestionAuthoring,
      allowLocalStrongBypass: false,
      now: () => 100,
    }),
  );
  const id = "00000000-0000-4000-8000-000000000001";
  const post = (path: string, items: unknown[]) =>
    app.request(`/v1/admin/${path}`, {
      method: "POST",
      body: JSON.stringify({ items }),
    });
  for (const [path, item] of [
    ["question-drafts/publish-batch", { id, revision: "1", visibility: "global" }],
    ["question-drafts/delete-batch", { id, revision: "1" }],
    ["question-publications/delete-batch", { id, current: true }],
  ] as const) {
    expect((await post(path, [item])).status).toBe(200);
    expect((await post(path, [])).status).toBe(400);
    expect((await post(path, Array(17).fill(item))).status).toBe(400);
    expect((await post(path, [item, item])).status).toBe(400);
    expect((await post(path, [{ ...item, id: "invalid" }])).status).toBe(400);
    expect((await post(path, [{ ...item, ownerId: "victim" }])).status).toBe(400);
  }
  expect(calls).toHaveLength(3);
  expect(calls[0]).toMatchObject({
    actor: { userId: "owner", globalAllowed: false },
    batch: { action: "publish" },
  });
  expect((await post("question-publications/delete-batch", [{ id }])).status).toBe(400);
  expect(
    (await post("question-drafts/publish-batch", [{ id, revision: "1", visibility: "any" }]))
      .status,
  ).toBe(400);
  expect((await post("question-drafts/delete-batch", [{ id, revision: "0" }])).status).toBe(400);
  identity = undefined;
  expect((await post("question-drafts/delete-batch", [{ id, revision: "1" }])).status).toBe(401);
  expect(calls).toHaveLength(3);
});
