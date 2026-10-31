import { afterAll, beforeAll, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
import { prearmReceipts } from "../../events/scheduling/prearm.ts";
import { parseWorkspaceCommand } from "../../../../modules/judging/admission/command.ts";
import { admitWithRecovery } from "../../../../modules/judging/admission/admit.ts";
import { postgresWorkspaceAdmission } from "./repository.ts";
import type { GuestPrincipal } from "../../../../modules/identity/model.ts";
const url = process.env.QUOREM_ADMISSION_TEST_DATABASE_URL;
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
const base = crypto.randomUUID(),
  host = `host-${base}`,
  guests = [`ga-${base}`, `gb-${base}`],
  matches = [crypto.randomUUID(), crypto.randomUUID()],
  workspaces = [crypto.randomUUID(), crypto.randomUUID()],
  problem = crypto.randomUUID(),
  version = crypto.randomUUID();
const principal = (index: number): GuestPrincipal => ({
  kind: "guest",
  userId: guests[index],
  displayName: "Guest",
  admin: false,
  emailVerified: false,
  sessionId: `token-${matches[index]}`,
  strongUntil: 0,
  credentialExpiresAt: 9999999999,
  scope: { kind: "match", matchId: matches[index] },
});
beforeAll(async () => {
  if (!url) return;
  await migrate(
    pool,
    "product",
    fileURLToPath(new URL("../../../../../migrations/", import.meta.url)),
  );
  await pool.query(
    "INSERT INTO users(id,display_name,kind) VALUES($1,'Host','account'),($2,'Guest','guest'),($3,'Guest','guest')",
    [host, ...guests],
  );
  await pool.query("INSERT INTO problems(id,slug) VALUES($1,$2)", [problem, problem]);
  await pool.query(
    "INSERT INTO problem_versions(id,version,problem_id,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES($1,1,$2,'Fixture','easy','',$3::jsonb,'[]'::jsonb,'{}'::jsonb,'')",
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
    "INSERT INTO quota_overrides(user_id,resource,value,actor,reason) VALUES($1,'guest_concurrency',1,'fixture','test')",
    [host],
  );
  for (let i = 0; i < 2; i++) {
    await pool.query(
      "INSERT INTO matches(id,host_owner_id,invite_hash,expires_at,duration_minutes,state,difficulties,started_at,deadline,problem_version_id) VALUES($1,$2,$1::uuid::text,clock_timestamp()+interval '1 hour',30,'active',ARRAY['easy'],clock_timestamp(),clock_timestamp()+interval '1 hour',$3)",
      [matches[i], host, version],
    );
    await pool.query(
      "INSERT INTO match_participants(match_id,owner_id,seat) VALUES($1,$2,1),($1,$3,2)",
      [matches[i], host, guests[i]],
    );
    await pool.query(
      "INSERT INTO guest_sessions(token_hash,owner_id,match_id,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')",
      [`token-${matches[i]}`, guests[i], matches[i]],
    );
    await pool.query(
      "INSERT INTO workspaces(id,owner_id,problem_version_id,language,kind,match_id) VALUES($1,$2,$3,'python','match',$4)",
      [workspaces[i], guests[i], version, matches[i]],
    );
  }
});
afterAll(async () => {
  if (!url) {
    await pool.end();
    return;
  }
  await pool.query(
    "DELETE FROM execution_dispatch_intents WHERE job_id IN (SELECT j.id FROM execution_jobs j JOIN submissions s ON s.id=j.submission_id WHERE s.owner_id=ANY($1))",
    [guests],
  );
  await pool.query("DELETE FROM execution_idempotency WHERE owner_id=ANY($1)", [guests]);
  await pool.query("DELETE FROM guest_execution_usage WHERE sponsor_id=$1", [host]);
  await pool.query(
    "DELETE FROM execution_jobs WHERE submission_id IN (SELECT id FROM submissions WHERE owner_id=ANY($1))",
    [guests],
  );
  await pool.query("DELETE FROM submissions WHERE owner_id=ANY($1)", [guests]);
  await pool.query("DELETE FROM workspaces WHERE owner_id=ANY($1)", [guests]);
  await pool.query("DELETE FROM match_outbox WHERE match_id=ANY($1::uuid[])", [matches]);
  await pool.query("DELETE FROM guest_sessions WHERE owner_id=ANY($1)", [guests]);
  await pool.query("DELETE FROM match_participants WHERE match_id=ANY($1::uuid[])", [matches]);
  await pool.query("DELETE FROM matches WHERE id=ANY($1::uuid[])", [matches]);
  await pool.query("DELETE FROM guest_sponsor_locks WHERE user_id=$1", [host]);
  await pool.query("DELETE FROM quota_overrides WHERE user_id=$1", [host]);
  await pool.query("DELETE FROM users WHERE id=ANY($1)", [[host, ...guests]]);
  await pool.query("DELETE FROM problem_examples WHERE version_id=$1", [version]);
  await pool.query("DELETE FROM problem_test_cases WHERE version_id=$1", [version]);
  await pool.query("DELETE FROM problem_languages WHERE version_id=$1", [version]);
  await pool.query("DELETE FROM problem_versions WHERE id=$1", [version]);
  await pool.query("DELETE FROM problems WHERE id=$1", [problem]);
  await pool.end();
});
async function start(index: number) {
  const command = await parseWorkspaceCommand(
    JSON.stringify({ workspaceId: workspaces[index], kind: "submit", source: "x" }),
    `key-${index}`,
  );
  return admitWithRecovery({
    receipts,
    coordinator: { prearm: async () => {}, wake: async () => {} },
    publisher: { send: async () => {} },
    shard: 1,
    commit: (fence) => admit(principal(index), `key-${index}`, command, fence),
  });
}
it.skipIf(!url)(
  "shares sponsor capacity across matches and reconciles a real match submit",
  async () => {
    const locker = await pool.connect();
    try {
      await locker.query("BEGIN");
      await locker.query(
        "UPDATE matches SET deadline=clock_timestamp()+interval '150 milliseconds' WHERE id=$1",
        [matches[0]],
      );
      const waiting = start(0);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await locker.query("COMMIT");
      await expect(waiting).rejects.toMatchObject({ code: "invalid_transition" });
    } finally {
      locker.release();
    }
    await pool.query(
      "UPDATE matches SET deadline=clock_timestamp()+interval '1 hour' WHERE id=$1",
      [matches[0]],
    );
    const result = await start(0);
    expect(result.state).toBe("queued");
    expect(
      (
        await pool.query(
          "SELECT 1 FROM guest_execution_usage WHERE submission_id=$1 AND sponsor_id=$2",
          [result.id, host],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "SELECT submission_state FROM match_participants WHERE match_id=$1 AND owner_id=$2",
          [matches[0], guests[0]],
        )
      ).rows[0].submission_state,
    ).toBe("queued");
    await expect(start(1)).rejects.toMatchObject({ code: "rate_limited" });
  },
);
