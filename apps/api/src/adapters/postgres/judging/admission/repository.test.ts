import {
  AdmissionRecovery,
  type AdmissionAlarmStorage,
} from "../../../../modules/judging/admission/recovery.ts";
import { dispatchBatch } from "../../../../modules/events/dispatch/dispatch.ts";
import { postgresDispatch } from "../../events/dispatch.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { createNodePool, withNodeConnection, DatabaseFailure } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
import { prearmReceipts } from "../../events/scheduling/prearm.ts";
import { parseWorkspaceCommand } from "../../../../modules/judging/admission/command.ts";
import { admitWithRecovery } from "../../../../modules/judging/admission/admit.ts";
import { postgresWorkspaceAdmission } from "./repository.ts";
import type { Principal } from "../../../../modules/identity/model.ts";
const url = process.env.QUOREM_ADMISSION_TEST_DATABASE_URL;
describe.skipIf(!url)("workspace admission in PostgreSQL", () => {
  const parsed = new URL(url ?? "postgres://127.0.0.1:55458/quorem_hono_admission_test");
  if (
    parsed.port !== "55458" ||
    parsed.pathname !== "/quorem_hono_admission_test" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
  )
    throw new Error("Disposable admission database required");
  const pool = createNodePool({
    connectionString: url!,
    max: 8,
    connectionTimeoutMs: 2000,
    idleTimeoutMs: 1000,
    onIdleError: () => {},
  });
  const run = <T>(fn: Parameters<typeof withNodeConnection<T>>[2]) =>
    withNodeConnection(pool, { lifetimeMs: 12000 }, fn);
  const receipts = prearmReceipts(run, "execution"),
    admit = postgresWorkspaceAdmission(run, { losslessCases: true, guestExecution: true });
  const id = crypto.randomUUID(),
    user = `fixture-${id}`,
    problem = crypto.randomUUID(),
    version = crypto.randomUUID(),
    workspace = crypto.randomUUID(),
    version2 = crypto.randomUUID(),
    workspace2 = crypto.randomUUID();
  const principal: Principal = {
    kind: "local",
    userId: user,
    displayName: "Fixture",
    admin: false,
    emailVerified: true,
    sessionId: "fixture",
    strongUntil: 0,
  };
  beforeAll(async () => {
    await migrate(
      pool,
      "product",
      fileURLToPath(new URL("../../../../../migrations/", import.meta.url)),
    );
    await pool.query("INSERT INTO users(id,display_name) VALUES($1,'Fixture')", [user]);
    await pool.query("INSERT INTO problems(id,slug) VALUES($1,$2)", [problem, problem]);
    await pool.query(
      `INSERT INTO problem_versions(id,version,problem_id,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES($1,1,$2,'Fixture','easy','',$3::jsonb,'[]'::jsonb,'{"wallTimeMs":2000,"memoryBytes":268435456,"outputBytes":65536,"maxProcesses":16,"maxCollectionElements":10000,"maxNestingDepth":100}'::jsonb,'')`,
      [
        version,
        problem,
        JSON.stringify({
          className: "Solution",
          methodName: "f",
          parameters: [{ name: "x", type: "int" }],
          returnType: "int",
        }),
      ],
    );
    await pool.query(
      "INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES($1,'python','','python-3.12-v1','quorem-harness-v2','')",
      [version],
    );
    await pool.query(
      "INSERT INTO problem_examples(version_id,ordinal,args,expected) VALUES($1,0,'[1]'::jsonb,'2'::jsonb)",
      [version],
    );
    await pool.query(
      "INSERT INTO problem_test_cases(version_id,ordinal,args,expected) VALUES($1,0,'[3]'::jsonb,'4'::jsonb)",
      [version],
    );
    await pool.query(
      "INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES($1,$2,$3,'python')",
      [workspace, user, version],
    );
  });
  afterAll(async () => {
    await pool.query(
      "DELETE FROM execution_dispatch_intents WHERE job_id IN (SELECT j.id FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE s.owner_id=$1)",
      [user],
    );
    await pool.query("DELETE FROM execution_idempotency WHERE owner_id=$1", [user]);
    await pool.query(
      "DELETE FROM execution_jobs WHERE submission_id IN (SELECT id FROM submissions WHERE owner_id=$1)",
      [user],
    );
    await pool.query("DELETE FROM submissions WHERE owner_id=$1", [user]);
    await pool.query("DELETE FROM workspaces WHERE owner_id=$1", [user]);
    await pool.query("DELETE FROM users WHERE id=$1", [user]);
    await pool.query("DELETE FROM problem_examples WHERE version_id=$1", [version]);
    await pool.query("DELETE FROM problem_test_cases WHERE version_id=$1", [version]);
    await pool.query("DELETE FROM problem_languages WHERE version_id=ANY($1::uuid[])", [
      [version, version2],
    ]);
    await pool.query("DELETE FROM problem_versions WHERE id=ANY($1::uuid[])", [
      [version, version2],
    ]);
    await pool.query("DELETE FROM problems WHERE id=$1", [problem]);
    await pool.end();
  });
  const command = (source: string) =>
    parseWorkspaceCommand(
      JSON.stringify({ workspaceId: workspace, kind: "run", source }),
      "same-key",
    );
  const start = async (key: string, source: string) => {
    const value = await command(source);
    return admitWithRecovery({
      receipts,
      coordinator: { prearm: async () => {}, wake: async () => {} },
      publisher: { send: async () => {} },
      shard: 0,
      commit: (fence) => admit(principal, key, value, fence),
    });
  };
  it("atomically records job, intent and idempotent result and rejects changed source", async () => {
    const [first, again] = await Promise.all([
      start("same-key", "return 1"),
      start("same-key", "return 1"),
    ]);
    expect(again).toEqual(first);
    await expect(start("same-key", "return 2")).rejects.toMatchObject({
      code: "idempotency_conflict",
    });
    const rows = await pool.query(
      "SELECT s.cases,j.id AS job,i.id AS intent FROM submissions s JOIN execution_jobs j ON j.submission_id=s.id JOIN execution_dispatch_intents i ON i.job_id=j.id WHERE s.id=$1",
      [first.id],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].cases).toEqual([{ args: [1], expected: 2 }]);
    await expect(start("different-key", "return 1")).rejects.toMatchObject({ code: "user_busy" });
    await pool.query("UPDATE execution_jobs SET finished=true WHERE submission_id=$1", [first.id]);
    await pool.query("UPDATE submissions SET state='completed' WHERE id=$1", [first.id]);
    const submit = await parseWorkspaceCommand(
      JSON.stringify({
        workspaceId: workspace,
        kind: "submit",
        source: "class Solution:\n    def f(self, x):\n        return x + 1\n",
      }),
      "submit",
    );
    const second = await admitWithRecovery({
      receipts,
      coordinator: { prearm: async () => {}, wake: async () => {} },
      publisher: { send: async () => {} },
      shard: 0,
      commit: (fence) => admit(principal, "submit", submit, fence),
    });
    expect(Object.keys(second).sort()).toEqual(["admittedAt", "id", "sourceHash", "state"]);
    expect(
      (await pool.query("SELECT cases FROM submissions WHERE id=$1", [second.id])).rows[0].cases,
    ).toEqual([{ args: [3], expected: 4 }]);
    if (process.env.QUOREM_ADMISSION_GO_JUDGE === "true") {
      const response = await fetch("http://127.0.0.1:58758/internal/drain", {
        method: "POST",
        headers: { authorization: `Bearer ${"fixture-token-".repeat(3)}` },
      });
      expect(response.ok).toBe(true);
      const result = (
        await pool.query("SELECT state,result FROM submissions WHERE id=$1", [second.id])
      ).rows[0];
      expect(result.state).toBe("completed");
      expect(result.result.verdict).toBe("accepted");
    }
  }, 30000);
  it("gates and preserves NUL custom cases without rounding numeric tokens", async () => {
    await pool.query(
      "UPDATE execution_jobs SET finished=true WHERE submission_id IN (SELECT id FROM submissions WHERE owner_id=$1)",
      [user],
    );
    await pool.query("UPDATE submissions SET state='completed' WHERE owner_id=$1", [user]);
    await pool.query(
      "UPDATE users SET admission_tokens=2,tokens_updated_at=clock_timestamp() WHERE id=$1",
      [user],
    );
    await pool.query(
      "INSERT INTO problem_versions(id,version,problem_id,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES($1,2,$2,'Fixture','easy','',$3::jsonb,'[]'::jsonb,$4::jsonb,'')",
      [
        version2,
        problem,
        JSON.stringify({
          className: "Solution",
          methodName: "f",
          parameters: [{ name: "x", type: "str" }],
          returnType: "str",
        }),
        JSON.stringify({
          wallTimeMs: 2000,
          memoryBytes: 268435456,
          outputBytes: 65536,
          maxProcesses: 16,
          maxCollectionElements: 10000,
          maxNestingDepth: 100,
        }),
      ],
    );
    await pool.query(
      "INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES($1,'python','','python-3.12-v1','quorem-harness-v2','')",
      [version2],
    );
    await pool.query(
      "INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES($1,$2,$3,'python')",
      [workspace2, user, version2],
    );
    const command = await parseWorkspaceCommand(
      JSON.stringify({
        workspaceId: workspace2,
        kind: "run",
        source: "class Solution:\n    def f(self, x):\n        return x\n",
        customCases: [{ args: ["a\u0000b"] }],
      }),
      "custom",
    );
    const attempt = async (enabled: boolean) =>
      admitWithRecovery({
        receipts,
        coordinator: { prearm: async () => {}, wake: async () => {} },
        publisher: { send: async () => {} },
        shard: 0,
        commit: (fence) =>
          postgresWorkspaceAdmission(run, { losslessCases: enabled, guestExecution: true })(
            principal,
            "custom",
            command,
            fence,
          ),
      });
    await expect(attempt(false)).rejects.toMatchObject({ code: "invalid_input" });
    const result = await attempt(true);
    const saved = (
      await pool.query(
        "SELECT cases,convert_from(lossless_cases,'UTF8') AS lossless FROM submissions WHERE id=$1",
        [result.id],
      )
    ).rows[0];
    expect(saved.cases).toEqual([{ args: ["ab"] }]);
    expect(saved.lossless).toContain("\\u0000");
    if (process.env.QUOREM_ADMISSION_GO_JUDGE === "true") {
      const response = await fetch("http://127.0.0.1:58758/internal/drain", {
        method: "POST",
        headers: { authorization: `Bearer ${"fixture-token-".repeat(3)}` },
      });
      expect(response.ok).toBe(true);
      const judged = (
        await pool.query("SELECT state,result FROM submissions WHERE id=$1", [result.id])
      ).rows[0];
      expect(judged.state).toBe("completed");
      expect(judged.result.publicCases[0].status).toBe("executed");
    }
  }, 30000);
  it("enforces replenishing and daily execution quotas", async () => {
    await pool.query(
      "UPDATE execution_jobs SET finished=true WHERE submission_id IN (SELECT id FROM submissions WHERE owner_id=$1)",
      [user],
    );
    await pool.query("UPDATE submissions SET state='completed' WHERE owner_id=$1", [user]);
    await pool.query(
      "UPDATE users SET admission_tokens=0,tokens_updated_at=clock_timestamp() WHERE id=$1",
      [user],
    );
    await expect(start("token-limit", "x")).rejects.toMatchObject({ code: "quota_exceeded" });
    await pool.query(
      "UPDATE users SET admission_tokens=2,tokens_updated_at=clock_timestamp() WHERE id=$1",
      [user],
    );
    await pool.query(
      "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) SELECT gen_random_uuid(),$1,$2,'run','','hash','completed','[]'::jsonb FROM generate_series(1,100)",
      [user, workspace],
    );
    await expect(start("daily-limit", "x")).rejects.toMatchObject({ code: "quota_exceeded" });
  });
  it("serializes and enforces the global queue bound", async () => {
    await pool.query(
      "DELETE FROM execution_dispatch_intents WHERE job_id IN (SELECT j.id FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE s.owner_id=$1)",
      [user],
    );
    await pool.query("DELETE FROM execution_idempotency WHERE owner_id=$1", [user]);
    await pool.query(
      "DELETE FROM execution_jobs WHERE submission_id IN (SELECT id FROM submissions WHERE owner_id=$1)",
      [user],
    );
    await pool.query("DELETE FROM submissions WHERE owner_id=$1", [user]);
    await pool.query(
      "UPDATE users SET admission_tokens=2,tokens_updated_at=clock_timestamp() WHERE id=$1",
      [user],
    );
    const prefix = `queue-${crypto.randomUUID()}-`;
    try {
      await pool.query(
        `WITH u AS (INSERT INTO users(id,display_name) SELECT $1||n,'Queue fixture' FROM generate_series(1,200) n RETURNING id), w AS (INSERT INTO workspaces(id,owner_id,problem_version_id,language) SELECT gen_random_uuid(),id,$2,'python' FROM u RETURNING id,owner_id), s AS (INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) SELECT gen_random_uuid(),owner_id,id,'run','','hash','queued','[]'::jsonb FROM w RETURNING id) INSERT INTO execution_jobs(id,submission_id) SELECT gen_random_uuid(),id FROM s`,
        [prefix, version],
      );
      await expect(start("queue-limit", "x")).rejects.toMatchObject({ code: "queue_saturated" });
    } finally {
      await pool.query(
        "DELETE FROM execution_jobs WHERE submission_id IN (SELECT id FROM submissions WHERE owner_id LIKE $1)",
        [prefix + "%"],
      );
      await pool.query("DELETE FROM submissions WHERE owner_id LIKE $1", [prefix + "%"]);
      await pool.query("DELETE FROM workspaces WHERE owner_id LIKE $1", [prefix + "%"]);
      await pool.query("DELETE FROM users WHERE id LIKE $1", [prefix + "%"]);
    }
  });
  it("recovers a committed job when the commit acknowledgment is lost", async () => {
    await pool.query(
      "UPDATE users SET admission_tokens=2,tokens_updated_at=clock_timestamp() WHERE id=$1",
      [user],
    );
    const data = new Map<string, unknown>();
    let alarm: number | null = null;
    const tx = {
      get: async <T>(key: string) => data.get(key) as T | undefined,
      put: async <T>(key: string, value: T) => {
        data.set(key, value);
      },
      getAlarm: async () => alarm,
      setAlarm: async (value: number) => {
        alarm = value;
      },
      deleteAlarm: async () => {
        alarm = null;
      },
    };
    const storage: AdmissionAlarmStorage = { ...tx, transaction: async (action) => action(tx) };
    const sent: string[] = [];
    const actor = new AdmissionRecovery(storage, receipts, () =>
      dispatchBatch(
        postgresDispatch(run),
        { publish: async () => {} },
        {
          send: async (wake) => {
            sent.push(wake.jobId);
          },
        },
        "execution",
      ),
    );
    const cmd = await command("x"),
      key = "lost-ack";
    let receiptId = "",
      jobId = "",
      attempts = 0;
    await expect(
      admitWithRecovery({
        receipts,
        coordinator: actor,
        publisher: { send: async () => {} },
        shard: 22,
        commit: async (fence) => {
          attempts++;
          receiptId = fence.receiptId;
          jobId = fence.jobId;
          await admit(principal, key, cmd, fence);
          throw new DatabaseFailure("unknown_commit");
        },
      }),
    ).rejects.toMatchObject({ kind: "unknown_commit" });
    expect(attempts).toBe(1);
    expect((await pool.query("SELECT 1 FROM execution_jobs WHERE id=$1", [jobId])).rowCount).toBe(
      1,
    );
    expect(await receipts.settle(receiptId)).toBe("committed");
    await actor.alarm();
    expect(sent).toContain(jobId);
    expect(await receipts.settle(receiptId)).toBe("abandoned");
  });
});
