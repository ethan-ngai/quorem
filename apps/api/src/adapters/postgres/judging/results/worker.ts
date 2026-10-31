/** @file worker.ts @description Workerd result and cancellation PostgreSQL conformance. @module judging */
/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withWorkerConnection, type ConnectionScope } from "@quorem/database/core";
import { createApp } from "../../../../app.ts";
import { submissionRoutes } from "../../../../modules/judging/results/routes.ts";
import { developmentIdentity } from "../../identity/repository.ts";
import { submissionSnapshots } from "./repository.ts";
const url = (env as unknown as { RESULTS_TEST_URL: string }).RESULTS_TEST_URL;
it("reads and cancels real owner submissions through workerd", async () => {
  const parsed = new URL(url);
  expect(["127.0.0.1", "localhost"]).toContain(parsed.hostname);
  expect(["55459:/quorem_hono_results_test", "55465:/quorem_hono_result_stream_test"]).toContain(
    `${parsed.port}:${parsed.pathname}`,
  );
  const run = <T>(f: (scope: ConnectionScope) => Promise<T>) =>
    withWorkerConnection(url, { connectionTimeoutMs: 1000, lifetimeMs: 5000 }, f);
  const owner = crypto.randomUUID(),
    workspace = crypto.randomUUID(),
    submission = crypto.randomUUID();
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      const version = (
        await tx.execute<{ id: string }>(sql`SELECT id::text FROM problem_versions LIMIT 1`)
      ).rows[0].id;
      await tx.execute(sql`INSERT INTO users(id,display_name) VALUES(${owner},'Worker')`);
      await tx.execute(
        sql`INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES(${workspace}::uuid,${owner},${version}::uuid,'python')`,
      );
      await tx.execute(
        sql`INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) VALUES(${submission}::uuid,${owner},${workspace}::uuid,'run','','worker-hash','queued','[]')`,
      );
      await tx.execute(
        sql`INSERT INTO execution_jobs(id,submission_id) VALUES(${crypto.randomUUID()}::uuid,${submission}::uuid)`,
      );
    }),
  );
  const app = createApp({ allowedOrigins: [], requestId: () => "worker-request" }).route(
    "/",
    submissionRoutes({
      snapshots: submissionSnapshots(run),
      identify: () => run((scope) => developmentIdentity(scope, owner)),
    }),
  );
  const first = await app.request(`/v1/submissions/${submission}`);
  expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({ id: submission, state: "queued" });
  const cancel = () =>
    app.request(`/v1/submissions/${submission}/cancel`, {
      method: "POST",
      headers: { "Idempotency-Key": "worker-operation" },
    });
  const response = await cancel();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ id: submission, state: "cancelled" });
  expect((await cancel()).status).toBe(200);
});
it("keeps lossless results and private fields bounded in workerd", async () => {
  const run = <T>(f: (scope: ConnectionScope) => Promise<T>) =>
    withWorkerConnection(url, { connectionTimeoutMs: 1000, lifetimeMs: 5000 }, f);
  const id = await run((scope) =>
    scope.transaction(
      { statementTimeoutMs: 3000, lockTimeoutMs: 1000 },
      async (tx) =>
        (
          await tx.execute<{ id: string }>(
            sql`SELECT id::text FROM submissions WHERE owner_id='results-alice' AND workspace_id IS NOT NULL AND result_payload IS NOT NULL AND result->>'verdict'='wrong_answer' LIMIT 1`,
          )
        ).rows[0].id,
    ),
  );
  const app = createApp({ allowedOrigins: [], requestId: () => "worker-private" }).route(
    "/",
    submissionRoutes({
      snapshots: submissionSnapshots(run),
      identify: () => run((scope) => developmentIdentity(scope, "results-alice")),
    }),
  );
  const response = await app.request(`/v1/submissions/${id}`),
    body = await response.text();
  expect(response.status).toBe(200);
  expect(body).toContain("9007199254740993");
  expect(body).toContain("A\\u0000B");
  expect(body).not.toMatch(/PRIVATE|SECRET|LEAK/);
});
it("rejects revoked match guest credentials against PostgreSQL", async () => {
  const { guestRepository } = await import("../../identity/guest.ts");
  const run = <T>(f: (scope: ConnectionScope) => Promise<T>) =>
    withWorkerConnection(url, { connectionTimeoutMs: 1000, lifetimeMs: 5000 }, f);
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(
        sql`UPDATE guest_sessions SET revoked_at=NULL,expires_at=clock_timestamp()+interval '1 hour',last_seen_at=clock_timestamp() WHERE token_hash='guest-token-hash'`,
      );
    }),
  );
  const guest = await run((scope) => guestRepository(scope).lookup("match", "guest-token-hash"));
  expect(guest).not.toBeNull();
  const id = await run((scope) =>
    scope.transaction(
      { statementTimeoutMs: 3000, lockTimeoutMs: 1000 },
      async (tx) =>
        (
          await tx.execute<{ id: string }>(
            sql`SELECT id::text FROM submissions WHERE owner_id='results-guest' LIMIT 1`,
          )
        ).rows[0].id,
    ),
  );
  const snapshots = submissionSnapshots(run);
  expect(JSON.parse(await new Response(await snapshots.read(guest!, id)).text()).id).toBe(id);
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(
        sql`UPDATE guest_sessions SET revoked_at=clock_timestamp() WHERE token_hash='guest-token-hash'`,
      );
    }),
  );
  await expect(snapshots.read(guest!, id)).rejects.toMatchObject({ code: "not_found" });
});

it("streams over 128 MiB from bounded rows without aggregating the body", async () => {
  const run = <T>(f: (scope: ConnectionScope) => Promise<T>) =>
    withWorkerConnection(url, { connectionTimeoutMs: 1000, lifetimeMs: 30000 }, f);
  const id = crypto.randomUUID();
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 25000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(
        sql`INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) SELECT ${id}::uuid,'results-alice',id,'run','','large','running','[]' FROM workspaces WHERE owner_id='results-alice' LIMIT 1`,
      );
      await tx.execute(
        sql`INSERT INTO submission_public_result_cases(submission_id,channel,ordinal,result_data) SELECT ${id}::uuid,'public',n,convert_to('{"index":'||n||',"status":"passed","actual":"'||repeat('x',CASE WHEN n=0 THEN 16777216 ELSE 1048576 END)||'"}','UTF8') FROM generate_series(0,128) n`,
      );
      await tx.execute(
        sql`INSERT INTO submission_result_headers(submission_id,header_data) VALUES(${id}::uuid,convert_to('{"verdict":"accepted","publicCasesPresent":true,"publicCaseCount":129,"channel":"public"}','UTF8'))`,
      );
      await tx.execute(
        sql`UPDATE submissions SET state='completed',result='{"verdict":"accepted"}' WHERE id=${id}::uuid`,
      );
    }),
  );
  const who = await run((scope) => developmentIdentity(scope, "results-alice"));
  const app = createApp({ allowedOrigins: [], requestId: () => "large-result" }).route(
    "/",
    submissionRoutes({ snapshots: submissionSnapshots(run), identify: async () => who }),
  );
  const response = await app.request(`/v1/submissions/${id}`);
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  let total = 0,
    max = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    max = Math.max(max, next.value.byteLength);
  }
  expect(total).toBeGreaterThan(128 * 1024 * 1024);
  expect(max).toBeLessThanOrEqual(65536);
}, 120000);
it("pages a large private result without buffering it in workerd", async () => {
  const run = <T>(f: (scope: ConnectionScope) => Promise<T>) =>
    withWorkerConnection(url, { connectionTimeoutMs: 1000, lifetimeMs: 30000 }, f);
  const id = crypto.randomUUID();
  const interview = await run((scope) =>
    scope.transaction({ statementTimeoutMs: 25000, lockTimeoutMs: 1000 }, async (tx) => {
      const e = (
        await tx.execute<{ session: string; source: string }>(
          sql`SELECT session_id::text AS session,submission_id::text AS source FROM interview_execution WHERE session_id=(SELECT id FROM interviews WHERE title='Interview') LIMIT 1`,
        )
      ).rows[0];
      await tx.execute(
        sql`INSERT INTO submissions(id,owner_id,interview_id,kind,source,source_hash,state,cases) VALUES(${id}::uuid,'results-alice',${e.session}::uuid,'submit','','large-private','running','[]')`,
      );
      await tx.execute(
        sql`INSERT INTO interview_execution(submission_id,session_id,document_version,document_epoch,question_epoch,fixture_id,level,private_results) SELECT ${id}::uuid,session_id,document_version,document_epoch,question_epoch,fixture_id,level,'[{"index":0,"status":"passed"}]'::jsonb FROM interview_execution WHERE submission_id=${e.source}::uuid`,
      );
      await tx.execute(
        sql`INSERT INTO interview_private_result_cases(submission_id,ordinal,result_data) VALUES(${id}::uuid,0,convert_to('{"index":0,"status":"passed","actual":"'||repeat('x',16777216)||'"}','UTF8'))`,
      );
      await tx.execute(
        sql`INSERT INTO submission_result_headers(submission_id,header_data) VALUES(${id}::uuid,convert_to('{"verdict":"accepted","hiddenCases":[{"index":0,"status":"passed"}],"publicCasesPresent":false,"publicCaseCount":0,"channel":"sample"}','UTF8'))`,
      );
      await tx.execute(
        sql`UPDATE submissions SET state='completed',result='{"verdict":"accepted"}' WHERE id=${id}::uuid`,
      );
      return e.session;
    }),
  );
  const who = await run((scope) => developmentIdentity(scope, "results-host"));
  const app = createApp({ allowedOrigins: [], requestId: () => "large-private" }).route(
    "/",
    submissionRoutes({ snapshots: submissionSnapshots(run), identify: async () => who }),
  );
  const response = await app.request(`/v1/interviews/${interview}/submissions/${id}`);
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  let total = 0,
    max = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    max = Math.max(max, next.value.byteLength);
  }
  expect(total).toBeGreaterThan(16 * 1024 * 1024);
  expect(max).toBeLessThanOrEqual(65536);
}, 120000);
it("streams an unbounded legacy diagnostic field over HTTP", async () => {
  const run = <T>(f: (scope: ConnectionScope) => Promise<T>) =>
    withWorkerConnection(url, { connectionTimeoutMs: 1000, lifetimeMs: 30000 }, f);
  const id = await run((scope) =>
    scope.transaction(
      { statementTimeoutMs: 5000, lockTimeoutMs: 1000 },
      async (tx) =>
        (
          await tx.execute<{ id: string }>(
            sql`SELECT id::text FROM submissions WHERE source_hash='large-legacy' LIMIT 1`,
          )
        ).rows[0].id,
    ),
  );
  const who = await run((scope) => developmentIdentity(scope, "results-alice"));
  const app = createApp({ allowedOrigins: [], requestId: () => "large-diagnostic" }).route(
    "/",
    submissionRoutes({ snapshots: submissionSnapshots(run), identify: async () => who }),
  );
  const response = await app.request(`/v1/submissions/${id}`);
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  let total = 0,
    max = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    max = Math.max(max, next.value.byteLength);
  }
  expect(total).toBeGreaterThan(32 * 1024 * 1024);
  expect(max).toBeLessThanOrEqual(65536);
}, 120000);
