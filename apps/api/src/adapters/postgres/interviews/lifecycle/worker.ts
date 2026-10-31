/** @file worker.ts @description Workerd interview snapshot against PostgreSQL. @module interviews */
/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:test";
import { it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { withWorkerConnection, type ConnectionScope } from "@quorem/database/core";
import { developmentIdentity } from "../../identity/repository.ts";
import { interviewSnapshotStream } from "../question/stream.ts";
const url = (env as unknown as { INTERVIEW_TEST_URL: string }).INTERVIEW_TEST_URL;
it("reads a revealed private case without exposing other cases in workerd", async () => {
  const parsed = new URL(url);
  expect([
    "55681:/quorem_hono_29c_lifecycle_test",
    "55462:/quorem_hono_interview_test",
    "55489:/quorem_hono_stream_lifecycle_test",
  ]).toContain(`${parsed.port}:${parsed.pathname}`);
  expect(parsed.hostname).toBe("127.0.0.1");
  const run = <T>(f: (scope: ConnectionScope) => Promise<T>) =>
    withWorkerConnection(url, { connectionTimeoutMs: 1000, lifetimeMs: 5000 }, f);
  const row = await run((scope) =>
    scope.transaction(
      { statementTimeoutMs: 3000, lockTimeoutMs: 1000 },
      async (tx) =>
        (
          await tx.execute<{ id: string; epoch: string }>(
            sql`SELECT i.id::text,p.question_epoch::text AS epoch FROM interviews i JOIN interview_public_examples p ON p.session_id=i.id WHERE i.title='Projection' AND p.level=1 AND position(convert_to('9007199254740993','UTF8') IN p.examples)>0 ORDER BY p.question_epoch LIMIT 1`,
          )
        ).rows[0],
    ),
  );
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(
        sql`UPDATE interviews SET question_epoch=${row.epoch}::uuid WHERE id=${row.id}::uuid`,
      );
      await tx.execute(
        sql`INSERT INTO interview_public_examples(session_id,question_epoch,level,examples) SELECT e.session_id,${row.epoch}::uuid,e.level,e.examples FROM interview_snapshot_public_examples e WHERE e.session_id=${row.id}::uuid AND EXISTS(SELECT 1 FROM interview_snapshot_public_examples first WHERE first.session_id=e.session_id AND first.fixture_id=e.fixture_id AND first.level=1 AND position(convert_to('9007199254740993','UTF8') IN first.examples)>0) ON CONFLICT DO NOTHING`,
      );
      await tx.execute(
        sql`INSERT INTO interview_case_visibility(session_id,question_epoch,case_id) VALUES(${row.id}::uuid,${row.epoch}::uuid,'level:1:case:0') ON CONFLICT DO NOTHING`,
      );
    }),
  );
  const who = await run((scope) => developmentIdentity(scope, "interview-member"));
  const output = await new Response(await interviewSnapshotStream(run)(who!, row.id)).text();
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
        snapshot: interviewSnapshotStream(run),
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
