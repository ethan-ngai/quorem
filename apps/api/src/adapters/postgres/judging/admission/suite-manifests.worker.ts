import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withWorkerConnection } from "@quorem/database/core";
import { indexRunnerFixture } from "../inputs/fixture.ts";
import { postgresWorkspaceAdmission } from "./repository.ts";
import { parseWorkspaceCommand } from "../../../../modules/judging/admission/command.ts";
import { prearmReceipts } from "../../events/scheduling/prearm.ts";
it("admits more than 320 indexed cases without Worker reference aggregation", async () => {
  const url = (env as unknown as { SUITE_DATABASE_URL: string }).SUITE_DATABASE_URL;
  const parsed = new URL(url);
  expect([parsed.hostname, parsed.port, parsed.pathname]).toEqual([
    "127.0.0.1",
    "55574",
    "/quorem_hono_suite_manifest_test",
  ]);
  const run = <T>(fn: Parameters<typeof withWorkerConnection<T>>[2]) =>
    withWorkerConnection(url, { connectionTimeoutMs: 2000, lifetimeMs: 20000 }, fn);
  const user = crypto.randomUUID(),
    problem = crypto.randomUUID(),
    version = crypto.randomUUID(),
    workspace = crypto.randomUUID();
  const signature = {
    className: "Solution",
    methodName: "f",
    parameters: [{ name: "x", type: "int" }],
    returnType: "int",
  };
  const levels = Array.from({ length: 8 }, (_, stage) => ({
    methods: [],
    examples: [{ args: [stage], expected: stage }],
  }));
  const hidden = Array.from({ length: 8 }, (_, stage) =>
    Array.from({ length: 50 }, (_, n) => ({ args: [stage * 50 + n], expected: stage * 50 + n })),
  );
  await run((scope) =>
    scope.transaction({ statementTimeoutMs: 10000, lockTimeoutMs: 1000 }, async (tx) => {
      await tx.execute(sql`INSERT INTO users(id,display_name) VALUES(${user},'Fixture')`);
      await tx.execute(sql`INSERT INTO problems(id,slug) VALUES(${problem}::uuid,${problem})`);
      await tx.execute(
        sql`INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution,odyssey) VALUES(${version}::uuid,${problem}::uuid,1,'Fixture','easy','',${JSON.stringify(signature)}::jsonb,'[]','{}','test',${JSON.stringify({ levels })}::jsonb)`,
      );
      await tx.execute(
        sql`INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES(${version}::uuid,'python','','python-3.12-v1','quorem-harness-v2','')`,
      );
      await tx.execute(
        sql`INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES(${workspace}::uuid,${user},${version}::uuid,'python')`,
      );
      await tx.execute(
        sql`INSERT INTO odyssey_progress(scope_id,problem_version_id,level) VALUES(${workspace}::uuid,${version}::uuid,8)`,
      );
      await indexRunnerFixture(
        tx,
        { version },
        JSON.stringify({
          problem: { signature, constraints: [], limits: {}, odyssey: { levels } },
          odysseyHiddenCases: hidden,
        }),
      );
    }),
  );
  const key = crypto.randomUUID(),
    fence = { receiptId: crypto.randomUUID(), jobId: crypto.randomUUID(), shard: 0 };
  await prearmReceipts(run, "execution").create(fence.receiptId, 0);
  const command = await parseWorkspaceCommand(
    JSON.stringify({ workspaceId: workspace, kind: "submit", source: "x", level: 8 }),
    key,
  );
  const result = await postgresWorkspaceAdmission(run, {
    losslessCases: true,
    guestExecution: true,
  })(
    {
      kind: "local",
      userId: user,
      displayName: "Fixture",
      admin: false,
      emailVerified: true,
      sessionId: "fixture",
      strongUntil: 0,
    },
    key,
    command,
    fence,
  );
  expect(result.state).toBe("queued");
  const row = await run((scope) =>
    scope.transaction(
      { statementTimeoutMs: 3000, lockTimeoutMs: 1000 },
      async (tx) =>
        (
          await tx.execute<{ n: number; first: number; last: number }>(
            sql`SELECT count(*)::int AS n,min(ordinal)::int AS first,max(ordinal)::int AS last FROM runner_job_input_cases WHERE job_id=${fence.jobId}::uuid`,
          )
        ).rows[0],
    ),
  );
  expect(row).toEqual({ n: 408, first: 0, last: 407 });
});
