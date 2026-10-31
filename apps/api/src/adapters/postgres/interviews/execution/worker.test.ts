import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withWorkerConnection, type ConnectionScope } from "@quorem/database/core";
import { sourceHash } from "@quorem/execution";
import { createApp } from "../../../../app.ts";
import { developmentIdentity } from "../../identity/repository.ts";
import { interviewLifecycle } from "../lifecycle/repository.ts";
import { preparePublishedInterviewQuestion } from "../question/prepare.ts";
import { interviewSnapshotStream } from "../question/stream.ts";
import { prearmReceipts } from "../../events/scheduling/prearm.ts";
import { interviewExecutionRoutes } from "../../../../modules/interviews/execution/routes.ts";
import { postgresInterviewAdmission } from "./repository.ts";
const url = (env as unknown as { INTERVIEW_EXECUTION_URL: string }).INTERVIEW_EXECUTION_URL;
it("admits and replays through workerd and real PostgreSQL", async () => {
  const db = new URL(url);
  expect([db.hostname, db.port, db.pathname]).toEqual([
    "127.0.0.1",
    "55576",
    "/quorem_hono_interview_execution_test",
  ]);
  const run = <T>(fn: (scope: ConnectionScope) => Promise<T>) =>
    withWorkerConnection(url, { connectionTimeoutMs: 3000, lifetimeMs: 10000 }, fn);
  const user = `worker-exec-${crypto.randomUUID()}`;
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(sql`INSERT INTO users(id,display_name) VALUES(${user},'Worker')`);
      await tx.execute(
        sql`INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES(${crypto.randomUUID()}::uuid,${user},'interviews.host','manual','test','test','test')`,
      );
    }),
  );
  const identify = () => run((scope) => developmentIdentity(scope, user)),
    actor = (await identify())!;
  const lifecycle = interviewLifecycle(run, {
    question: preparePublishedInterviewQuestion,
    snapshot: interviewSnapshotStream(run),
  });
  const room = JSON.parse(
    await new Response(
      await lifecycle.read(
        actor,
        JSON.parse(
          await lifecycle.create(actor, "create", {
            title: "Worker",
            question: {
              problemVersionId: "e91ec728-4597-5dfb-9d19-7c4ba17138b7",
              language: "python",
            },
          }),
        ).id,
      ),
    ).text(),
  );
  let sent = 0;
  const app = createApp({ allowedOrigins: [], requestId: () => "worker" }).route(
    "/",
    interviewExecutionRoutes({
      identify,
      guestExecution: true,
      receipts: prearmReceipts(run, "execution"),
      coordinator: { prearm: async () => {}, wake: async () => {} },
      publisher: {
        send: async () => {
          sent++;
        },
      },
      shard: 0,
      commit: postgresInterviewAdmission(run, { losslessCases: true, guestExecution: true }),
    }),
  );
  const command = JSON.stringify({
    kind: "run",
    level: 1,
    questionEpoch: room.questionEpoch,
    documentEpoch: room.document.epoch,
    sourceHash: await sourceHash(room.document.source),
  });
  const failing = createApp({ allowedOrigins: [], requestId: () => "worker" }).route(
    "/",
    interviewExecutionRoutes({
      identify,
      guestExecution: true,
      receipts: prearmReceipts(run, "execution"),
      coordinator: { prearm: async () => {}, wake: async () => {} },
      publisher: {
        send: async () => {
          throw new Error("offline");
        },
      },
      shard: 0,
      commit: postgresInterviewAdmission(run, { losslessCases: true, guestExecution: true }),
    }),
  );
  const failure = await failing.request(`/v1/interviews/${room.id}/submissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "wake-failure" },
    body: command,
  });
  expect(failure.status).toBe(503);
  const count = await run((scope) =>
    scope.transaction(
      { statementTimeoutMs: 3000, lockTimeoutMs: 1000 },
      async (tx) =>
        (
          await tx.execute(
            sql`SELECT count(*)::int AS n FROM submissions WHERE interview_id=${room.id}::uuid`,
          )
        ).rows[0],
    ),
  );
  expect(count.n).toBe(0);
  const request = () =>
    app.request(`/v1/interviews/${room.id}/submissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "worker-admit" },
      body: command,
    });
  const first = await request();
  expect(first.status).toBe(202);
  const a = (await first.json()) as { id: string };
  const second = await request();
  expect(second.status).toBe(202);
  expect(((await second.json()) as { id: string }).id).toBe(a.id);
  expect(sent).toBeGreaterThan(0);
});
