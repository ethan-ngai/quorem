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
  expect([parsed.hostname, parsed.port, parsed.pathname]).toEqual([
    "127.0.0.1",
    "55459",
    "/quorem_hono_results_test",
  ]);
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
            sql`SELECT id::text FROM submissions WHERE owner_id='results-alice' AND workspace_id IS NOT NULL AND result_payload IS NOT NULL LIMIT 1`,
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
  expect(JSON.parse(await snapshots.read(guest!, id)).id).toBe(id);
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(
        sql`UPDATE guest_sessions SET revoked_at=clock_timestamp() WHERE token_hash='guest-token-hash'`,
      );
    }),
  );
  await expect(snapshots.read(guest!, id)).rejects.toMatchObject({ code: "not_found" });
});
