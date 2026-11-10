/// <reference types="@cloudflare/vitest-plugin/types" />
import { assertRunnerFixture } from "../../judging/worker/test-db.ts";
import { blankApproach } from "@quorem/questions";
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withWorkerConnection } from "@quorem/database/core";
const url = (env as unknown as { AUTHORING_TEST_DATABASE_URL: string }).AUTHORING_TEST_DATABASE_URL;
const user = "quorem-author-worker";
describe.skipIf(!url)("native worker authoring", () => {
  beforeAll(async () => {
    assertRunnerFixture(url, ["/quorem_hono_authoring_test"]);
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
      canonicalApproachId: "default",
      approaches: [
        {
          ...blankApproach(),
          implementations: [{ language: "python", source: "class Solution: pass" }],
        },
      ],
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
    const edit = await SELF.fetch(
      `http://localhost/v1/admin/question-publications/${result.publishedVersionId}/edit`,
      { method: "POST" },
    );
    expect(edit.status).toBe(201);
    expect(await edit.json()).toMatchObject({
      id: d.id,
      publishedVersionId: result.publishedVersionId,
    });
    const stale = await SELF.fetch(`http://localhost/v1/admin/question-drafts/${d.id}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"revision":"2","visibility":"private"}',
    });
    expect(stale.status).toBe(409);
    const second = await SELF.fetch("http://localhost/v1/admin/question-drafts", {
      method: "POST",
      body: JSON.stringify({
        content: {
          ...question,
          problem: { ...question.problem, slug: question.problem.slug + "-second" },
        },
      }),
    });
    const next = (await second.json()) as { id: string; revision: string };
    const batch = await SELF.fetch("http://localhost/v1/admin/question-drafts/publish-batch", {
      method: "POST",
      body: JSON.stringify({
        items: [
          { id: d.id, revision: "2", visibility: "private" },
          { id: next.id, revision: next.revision, visibility: "private" },
        ],
      }),
    });
    expect(batch.status).toBe(200);
    expect(await batch.json()).toMatchObject({
      items: [
        { id: d.id, status: "failed", code: "revision_conflict" },
        { id: next.id, status: "succeeded" },
      ],
    });
    const saved = await SELF.fetch(`http://localhost/v1/admin/question-drafts/${next.id}`);
    const publication = (await saved.json()) as { publishedVersionId: string };
    const deleted = await SELF.fetch(
      "http://localhost/v1/admin/question-publications/delete-batch",
      {
        method: "POST",
        body: JSON.stringify({
          items: [
            { id: result.publishedVersionId },
            { id: publication.publishedVersionId },
            { id: crypto.randomUUID() },
          ],
        }),
      },
    );
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({
      items: [
        { status: "succeeded" },
        { status: "succeeded" },
        { status: "failed", code: "not_found" },
      ],
    });
  });
});
