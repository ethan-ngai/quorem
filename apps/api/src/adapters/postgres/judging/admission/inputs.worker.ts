/** @file inputs.worker.ts @description Real workerd normalized input admission. @module judging */
import { env } from "cloudflare:test";
import { it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { withWorkerConnection, type ConnectionScope } from "@quorem/database/core";
import { prearmReceipts } from "../../events/scheduling/prearm.ts";
import { parseWorkspaceCommand } from "../../../../modules/judging/admission/command.ts";
import { postgresWorkspaceAdmission } from "./repository.ts";
const url = (env as unknown as { INPUT_TEST_URL: string }).INPUT_TEST_URL;
it("admits a >128 MiB fixture as bounded references in workerd", async () => {
  const parsed = new URL(url);
  expect([parsed.hostname, parsed.port, parsed.pathname]).toEqual([
    "127.0.0.1",
    "55570",
    "/quorem_hono_input_admission_test",
  ]);
  const run = <T>(fn: (scope: ConnectionScope) => Promise<T>) =>
    withWorkerConnection(url, { connectionTimeoutMs: 3000, lifetimeMs: 15000 }, fn);
  const user = `input-worker-${crypto.randomUUID()}`,
    workspace = crypto.randomUUID();
  const row = await run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
      const data = (
        await tx.execute<{ version: string; size: string }>(
          sql`SELECT id::text AS version,octet_length(lossless_fixture)::bigint::text AS size FROM problem_versions WHERE title='Large' LIMIT 1`,
        )
      ).rows[0];
      await tx.execute(sql`INSERT INTO users(id,display_name) VALUES(${user},'Worker')`);
      await tx.execute(
        sql`INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES(${workspace}::uuid,${user},${data.version}::uuid,'python')`,
      );
      return { ...data, id: workspace };
    }),
  );
  expect(Number(row.size)).toBeGreaterThan(128 * 1024 * 1024);
  const receiptId = crypto.randomUUID(),
    jobId = crypto.randomUUID(),
    shard = 19;
  await prearmReceipts(run, "execution").create(receiptId, shard);
  const cmd = await parseWorkspaceCommand(
    JSON.stringify({ workspaceId: row.id, kind: "submit", source: "return 1" }),
    "worker-input",
  );
  const result = await postgresWorkspaceAdmission(run, {
    losslessCases: true,
    guestExecution: true,
  })(
    {
      kind: "local",
      userId: user,
      displayName: "Worker",
      admin: false,
      emailVerified: true,
      sessionId: "worker",
      strongUntil: 0,
    },
    "worker-input",
    cmd,
    { receiptId, jobId, shard },
  );
  expect(result.state).toBe("queued");
  const count = await run((scope) =>
    scope.transaction(
      { statementTimeoutMs: 5000, lockTimeoutMs: 1000 },
      async (tx) =>
        (
          await tx.execute<{ sealed: boolean; cases: number; samples: number }>(
            sql`SELECT sealed,case_count AS cases,sample_count AS samples FROM runner_job_inputs WHERE job_id=${jobId}::uuid`,
          )
        ).rows[0],
    ),
  );
  expect(count).toEqual({ sealed: true, cases: 100, samples: 1 });
});
it("admits an interview through its sealed current-epoch snapshot in workerd", async () => {
  const { sourceHash } = await import("@quorem/execution");
  const { parseInterviewExecution } =
    await import("../../../../modules/interviews/execution/command.ts");
  const { postgresInterviewAdmission } = await import("../../interviews/execution/repository.ts");
  const run = <T>(fn: (scope: ConnectionScope) => Promise<T>) =>
    withWorkerConnection(url, { connectionTimeoutMs: 3000, lifetimeMs: 15000 }, fn);
  const user = `interview-worker-${crypto.randomUUID()}`;
  const row = await run((scope) =>
    scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
      const room = (
        await tx.execute<{ id: string; epoch: string; document: string; source: string }>(
          sql`SELECT id::text,question_epoch::text AS epoch,document_epoch::text AS document,source FROM interviews WHERE title='Input' ORDER BY created_at DESC LIMIT 1`,
        )
      ).rows[0];
      await tx.execute(sql`INSERT INTO users(id,display_name) VALUES(${user},'Worker')`);
      await tx.execute(
        sql`INSERT INTO interview_members(session_id,user_id,role) VALUES(${room.id}::uuid,${user},'interviewee')`,
      );
      return room;
    }),
  );
  const receiptId = crypto.randomUUID(),
    jobId = crypto.randomUUID(),
    shard = 20;
  await prearmReceipts(run, "execution").create(receiptId, shard);
  const cmd = await parseInterviewExecution(
    JSON.stringify({
      kind: "submit",
      level: 1,
      questionEpoch: row.epoch,
      documentEpoch: row.document,
      sourceHash: await sourceHash(row.source),
    }),
    "worker-interview",
  );
  const result = await postgresInterviewAdmission(run, {
    losslessCases: true,
    guestExecution: true,
  })(
    {
      kind: "local",
      userId: user,
      displayName: "Worker",
      admin: false,
      emailVerified: true,
      sessionId: "worker",
      strongUntil: 0,
    },
    row.id,
    "worker-interview",
    cmd,
    { receiptId, jobId, shard },
  );
  expect(result.state).toBe("queued");
  const manifest = await run((scope) =>
    scope.transaction(
      { statementTimeoutMs: 5000, lockTimeoutMs: 1000 },
      async (tx) =>
        (
          await tx.execute<{ sealed: boolean; private: boolean; cases: number; samples: number }>(
            sql`SELECT sealed,private_details AS private,case_count AS cases,sample_count AS samples FROM runner_job_inputs WHERE job_id=${jobId}::uuid`,
          )
        ).rows[0],
    ),
  );
  expect(manifest).toEqual({ sealed: true, private: true, cases: 1, samples: 1 });
});
