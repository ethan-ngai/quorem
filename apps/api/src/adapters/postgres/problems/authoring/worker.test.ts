/// <reference types="@cloudflare/vitest-plugin/types" />
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withWorkerConnection } from "@quorem/database/core";
const url = (env as unknown as { AUTHORING_TEST_DATABASE_URL: string }).AUTHORING_TEST_DATABASE_URL;
const user = "quorem-author-worker";
describe.skipIf(!url)("native worker authoring", () => {
  beforeAll(async () => {
    const parsed = new URL(url);
    if (
      parsed.port !== "55447" ||
      parsed.pathname !== "/quorem_hono_authoring_test" ||
      !["127.0.0.1", "localhost"].includes(parsed.hostname)
    )
      throw new Error("disposable authoring database required");
    await withWorkerConnection(url, { connectionTimeoutMs: 1000, lifetimeMs: 10000 }, (scope) =>
      scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 2000 }, async (tx) => {
        await tx.execute(
          sql`INSERT INTO users(id,display_name) VALUES(${user},'Worker') ON CONFLICT(id) DO UPDATE SET disabled=false,role='user'`,
        );
        await tx.execute(
          sql`INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES(${crypto.randomUUID()}::uuid,${user},'questions.custom','manual',${crypto.randomUUID()},${user},'test')`,
        );
      }),
    );
  });
  it("creates, revises and publishes with real local identity", async () => {
    const question = {
      problem: {
        id: "00000000-0000-4000-8000-000000000000",
        slug: `worker-${crypto.randomUUID().slice(0, 8)}`,
        version: "0",
        title: "Worker",
        difficulty: "easy",
        tags: [],
        statementMarkdown: "Return x",
        examples: [{ args: [1], expected: 1 }],
        constraints: [],
        signature: {
          className: "Solution",
          methodName: "solve",
          parameters: [{ name: "x", type: "int" }],
          returnType: "int",
        },
        limits: {
          wallTimeMs: 2000,
          memoryBytes: 268435456,
          outputBytes: 65536,
          maxProcesses: 16,
          maxCollectionElements: 10000,
          maxNestingDepth: 100,
        },
      },
      hiddenCases: [{ args: [2], expected: 2 }],
      attribution: "fixture",
      implementations: [
        {
          language: "python",
          starterSource: "old",
          runtimeRevision: "python-3.12-v1",
          harnessRevision: "quorem-harness-v2",
          referenceSource: "class Solution: pass",
        },
      ],
      solutions: [],
    };
    const create = await SELF.fetch("http://localhost/v1/admin/question-drafts", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Quorem-Owner": "spoof" },
      body: JSON.stringify({ content: question }),
    });
    expect(create.status).toBe(201);
    const d = (await create.json()) as { id: string; revision: string };
    const update = await SELF.fetch(`http://localhost/v1/admin/question-drafts/${d.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: d.revision, content: question }),
    });
    expect(update.status).toBe(200);
    const publish = await SELF.fetch(`http://localhost/v1/admin/question-drafts/${d.id}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"revision":"2","visibility":"private"}',
    });
    expect(publish.status).toBe(200);
    const result = (await publish.json()) as { publishedVersionId: string };
    expect(result.publishedVersionId).toBeTruthy();
    const stale = await SELF.fetch(`http://localhost/v1/admin/question-drafts/${d.id}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"revision":"2","visibility":"private"}',
    });
    expect(stale.status).toBe(409);
  });
});
