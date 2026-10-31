import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import { withWorkerConnection } from "@quorem/database/core";
import { sql } from "drizzle-orm";
import { consumePrearm, prearmReceipts } from "../../events/scheduling/prearm.ts";
import { insertExecutionIntent } from "../../events/dispatch.ts";
import { indexRunnerFixture } from "../inputs/fixture.ts";
it("recovers a delayed commit, dispatches before ack, and cannot consume deadline receipts", async () => {
  const e = env as unknown as {
    ADMISSION_DATABASE_URL: string;
    RECOVERY: {
      idFromName(n: string): unknown;
      get(id: unknown): Parameters<typeof runDurableObjectAlarm>[0];
    };
  };
  const run = <T>(fn: Parameters<typeof withWorkerConnection<T>>[2]) =>
    withWorkerConnection(
      e.ADMISSION_DATABASE_URL,
      { connectionTimeoutMs: 3000, lifetimeMs: 10000 },
      fn,
    );
  const shard = 9,
    receipt = crypto.randomUUID(),
    other = crypto.randomUUID(),
    user = `worker-${crypto.randomUUID()}`;
  const problem = crypto.randomUUID(),
    version = crypto.randomUUID(),
    workspace = crypto.randomUUID(),
    submission = crypto.randomUUID(),
    job = crypto.randomUUID(),
    intent = crypto.randomUUID();
  const execution = prearmReceipts(run, "execution"),
    deadline = prearmReceipts(run, "deadline");
  const stub = e.RECOVERY.get(e.RECOVERY.idFromName(`execution-${shard}`));
  try {
    await execution.create(receipt, shard);
    await deadline.create(other, shard);
    await (stub as unknown as { prearm(n: number): Promise<void> }).prearm(shard);
    await run((scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
        await tx.execute(sql`INSERT INTO users(id,display_name) VALUES(${user},'Fixture')`);
        await tx.execute(sql`INSERT INTO problems(id,slug) VALUES(${problem}::uuid,${problem})`);
        await tx.execute(
          sql`INSERT INTO problem_versions(id,version,problem_id,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES(${version}::uuid,1,${problem}::uuid,'Fixture','easy','','{}'::jsonb,'[]'::jsonb,'{}'::jsonb,'')`,
        );
        await tx.execute(
          sql`INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES(${version}::uuid,'python','','python-3.12-v1','quorem-harness-v2','')`,
        );
        await tx.execute(
          sql`INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES(${workspace}::uuid,${user},${version}::uuid,'python')`,
        );
        await tx.execute(
          sql`INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) VALUES(${submission}::uuid,${user},${workspace}::uuid,'run','','hash','queued','[]'::jsonb)`,
        );
        await tx.execute(
          sql`INSERT INTO execution_jobs(id,submission_id) VALUES(${job}::uuid,${submission}::uuid)`,
        );
        await insertExecutionIntent(tx, intent, job);
        await consumePrearm(tx, receipt, shard, "execution");
        await expect(runDurableObjectAlarm(stub)).rejects.toThrow();
      }),
    );
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(
      await runInDurableObject(
        stub,
        (_instance: unknown, state: { storage: { get(key: string): Promise<unknown> } }) =>
          state.storage.get("published"),
      ),
    ).toBe(job);
    expect(await execution.settle(receipt)).toBe("abandoned");
    expect(await deadline.settle(other)).toBe("pending");
  } finally {
    await run((scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
        await tx.execute(sql`DELETE FROM execution_dispatch_intents WHERE id=${intent}::uuid`);
        await tx.execute(sql`DELETE FROM execution_jobs WHERE id=${job}::uuid`);
        await tx.execute(sql`DELETE FROM submissions WHERE id=${submission}::uuid`);
        await tx.execute(sql`DELETE FROM workspaces WHERE id=${workspace}::uuid`);
        await tx.execute(sql`DELETE FROM problem_versions WHERE id=${version}::uuid`);
        await tx.execute(sql`DELETE FROM problems WHERE id=${problem}::uuid`);
        await tx.execute(sql`DELETE FROM users WHERE id=${user}`);
        await tx.execute(
          sql`DELETE FROM deadline_prearms WHERE id IN (${receipt}::uuid,${other}::uuid)`,
        );
      }),
    );
  }
}, 15000);
it("admits an actual workspace job using workerd PostgreSQL and a prearmed Durable Object", async () => {
  const e = env as unknown as {
    ADMISSION_DATABASE_URL: string;
    RECOVERY: {
      idFromName(n: string): unknown;
      get(id: unknown): Parameters<typeof runDurableObjectAlarm>[0];
    };
  };
  const run = <T>(fn: Parameters<typeof withWorkerConnection<T>>[2]) =>
    withWorkerConnection(
      e.ADMISSION_DATABASE_URL,
      { connectionTimeoutMs: 3000, lifetimeMs: 10000 },
      fn,
    );
  const { postgresWorkspaceAdmission } = await import("./repository.ts");
  const { parseWorkspaceCommand } =
    await import("../../../../modules/judging/admission/command.ts");
  const { admitWithRecovery } = await import("../../../../modules/judging/admission/admit.ts");
  const shard = 10,
    user = `worker-${crypto.randomUUID()}`,
    problem = crypto.randomUUID(),
    version = crypto.randomUUID(),
    workspace = crypto.randomUUID();
  const stub = e.RECOVERY.get(e.RECOVERY.idFromName(`execution-${shard}`)) as unknown as {
    prearm(n: number): Promise<void>;
    wake(n: number): Promise<void>;
  };
  const published: string[] = [];
  try {
    await run((scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
        await tx.execute(sql`INSERT INTO users(id,display_name) VALUES(${user},'Fixture')`);
        await tx.execute(sql`INSERT INTO problems(id,slug) VALUES(${problem}::uuid,${problem})`);
        await tx.execute(
          sql`INSERT INTO problem_versions(id,version,problem_id,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES(${version}::uuid,1,${problem}::uuid,'Fixture','easy','',${JSON.stringify({ className: "Solution", methodName: "f", parameters: [{ name: "x", type: "int" }], returnType: "int" })}::jsonb,'[]'::jsonb,'{}'::jsonb,'')`,
        );
        await tx.execute(
          sql`INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES(${version}::uuid,'python','','python-3.12-v1','quorem-harness-v2','')`,
        );
        await tx.execute(
          sql`INSERT INTO problem_examples(version_id,ordinal,args,expected) VALUES(${version}::uuid,0,'[1]'::jsonb,'2'::jsonb)`,
        );
        await indexRunnerFixture(
          tx,
          { version },
          JSON.stringify({
            problem: {
              signature: {
                className: "Solution",
                methodName: "f",
                parameters: [{ name: "x", type: "int" }],
                returnType: "int",
              },
              constraints: [],
              limits: {},
              examples: [{ args: [1], expected: 2 }],
            },
            hiddenCases: [],
          }),
        );
        await tx.execute(
          sql`INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES(${workspace}::uuid,${user},${version}::uuid,'python')`,
        );
      }),
    );
    const command = await parseWorkspaceCommand(
      JSON.stringify({ workspaceId: workspace, kind: "run", source: "return 1" }),
      "worker-key",
    );
    const admit = postgresWorkspaceAdmission(run, { losslessCases: true, guestExecution: true });
    const result = await admitWithRecovery({
      receipts: prearmReceipts(run, "execution"),
      coordinator: stub,
      publisher: {
        send: async (wake) => {
          published.push(wake.phase);
        },
      },
      shard,
      commit: (fence) =>
        admit(
          {
            kind: "local",
            userId: user,
            displayName: "Fixture",
            admin: false,
            emailVerified: true,
            sessionId: "fixture",
            strongUntil: 0,
          },
          "worker-key",
          command,
          fence,
        ),
    });
    expect(result.state).toBe("queued");
    expect(published).toEqual(["admission"]);
    expect(await runDurableObjectAlarm(stub as Parameters<typeof runDurableObjectAlarm>[0])).toBe(
      true,
    );
    const counts = await run((scope) =>
      scope.transaction(
        { statementTimeoutMs: 3000, lockTimeoutMs: 1000, readOnly: true },
        async (tx) =>
          (
            await tx.execute(
              sql`SELECT count(*)::int AS n FROM execution_jobs j JOIN execution_dispatch_intents i ON i.job_id=j.id WHERE j.submission_id=${result.id}::uuid AND i.delivered_at IS NOT NULL`,
            )
          ).rows[0],
      ),
    );
    expect(counts.n).toBe(1);
  } finally {
    await run((scope) =>
      scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
        await tx.execute(
          sql`DELETE FROM execution_dispatch_intents WHERE job_id IN (SELECT j.id FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE s.owner_id=${user})`,
        );
        await tx.execute(sql`DELETE FROM execution_idempotency WHERE owner_id=${user}`);
        await tx.execute(
          sql`DELETE FROM execution_jobs WHERE submission_id IN (SELECT id FROM submissions WHERE owner_id=${user})`,
        );
        await tx.execute(sql`DELETE FROM submissions WHERE owner_id=${user}`);
        await tx.execute(sql`DELETE FROM workspaces WHERE owner_id=${user}`);
        await tx.execute(sql`DELETE FROM problem_examples WHERE version_id=${version}::uuid`);
        await tx.execute(sql`DELETE FROM problem_languages WHERE version_id=${version}::uuid`);
        await tx.execute(sql`DELETE FROM problem_versions WHERE id=${version}::uuid`);
        await tx.execute(sql`DELETE FROM problems WHERE id=${problem}::uuid`);
        await tx.execute(sql`DELETE FROM users WHERE id=${user}`);
      }),
    );
  }
}, 15000);
