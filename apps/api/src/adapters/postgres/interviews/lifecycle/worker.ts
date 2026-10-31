/** @file worker.ts @description Workerd interview snapshot against PostgreSQL. @module interviews */
/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:test";
import { it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { withWorkerConnection, type ConnectionScope } from "@quorem/database/core";
import { developmentIdentity } from "../../identity/repository.ts";
import { backfillInterviewPublicExamples } from "../question/public-examples.ts";
import { interviewSnapshot } from "../question/snapshot.ts";
const url = (env as unknown as { INTERVIEW_TEST_URL: string }).INTERVIEW_TEST_URL;
it("reads a revealed private case without exposing other cases in workerd", async () => {
  const parsed = new URL(url);
  expect([parsed.hostname, parsed.port, parsed.pathname]).toEqual([
    "127.0.0.1",
    "55462",
    "/quorem_hono_interview_test",
  ]);
  const run = <T>(f: (scope: ConnectionScope) => Promise<T>) =>
    withWorkerConnection(url, { connectionTimeoutMs: 1000, lifetimeMs: 5000 }, f);
  const row = await run((scope) =>
    scope.transaction(
      { statementTimeoutMs: 3000, lockTimeoutMs: 1000 },
      async (tx) =>
        (
          await tx.execute<{ id: string; epoch: string }>(
            sql`SELECT id::text,question_epoch::text AS epoch FROM interviews WHERE title='Projection'`,
          )
        ).rows[0],
    ),
  );
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
      backfillInterviewPublicExamples(tx, row.id, row.epoch),
    ),
  );
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(
        sql`INSERT INTO interview_case_visibility(session_id,question_epoch,case_id) VALUES(${row.id}::uuid,${row.epoch}::uuid,'level:1:case:0')`,
      );
    }),
  );
  const who = await run((scope) => developmentIdentity(scope, "interview-member"));
  const output = await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, (tx) =>
      interviewSnapshot(tx, who!, row.id),
    ),
  );
  expect(output).toContain("9007199254740993");
  expect(output).toContain("PRIVATE-ONE\\u0000");
  expect(output).not.toContain("PRIVATE-TWO");
  expect(output).not.toContain("SECRET REFERENCE");
});
it("joins through workerd HTTP with shared origin, budget and guest cookie rules", async () => {
  const { interviewLifecycle } = await import("./repository.ts");
  const { preparePublishedInterviewQuestion } = await import("../question/prepare.ts");
  const { interviewLifecycleRoutes } =
    await import("../../../../modules/interviews/lifecycle/routes.ts");
  const { createApp } = await import("../../../../app.ts");
  const { publicGuestBudget } = await import("../../identity/guest.ts");
  const run = <T>(f: (scope: ConnectionScope) => Promise<T>) =>
    withWorkerConnection(url, { connectionTimeoutMs: 1000, lifetimeMs: 5000 }, f);
  const token = await run((scope) =>
    scope.transaction(
      { statementTimeoutMs: 3000, lockTimeoutMs: 1000 },
      async (tx) =>
        (
          await tx.execute<{ token: string }>(
            sql`SELECT invite_token AS token FROM interviews WHERE title='Published' AND state='active'`,
          )
        ).rows[0].token,
    ),
  );
  const origin = "https://quorem.test";
  const app = createApp({ allowedOrigins: [origin], requestId: () => "worker" }).route(
    "/",
    interviewLifecycleRoutes({
      lifecycle: interviewLifecycle(run, {
        question: preparePublishedInterviewQuestion,
        snapshot: interviewSnapshot,
      }),
      identify: async () => undefined,
      allowedOrigins: [origin],
      trustedPeer: () => "127.0.0.1",
      budget: { allow: (peer) => run((scope) => publicGuestBudget(scope).allow(peer)) },
    }),
  );
  const response = await app.request(`/v1/interview-invites/${token}/join`, {
    method: "POST",
    headers: { origin },
    body: '{"name":"Worker Guest"}',
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toContain("quorem_interview_guest=");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.text()).not.toContain("privateCaseDetails");
});
