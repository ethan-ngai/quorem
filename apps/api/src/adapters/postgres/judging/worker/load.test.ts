import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
import { postgresClaims } from "./claim.ts";
import { postgresExecutionLoad } from "./load.ts";
const url = process.env.QUOREM_RUNNER_TEST_DATABASE_URL;
const parsed = new URL(url ?? "postgres://127.0.0.1:55464/quorem_hono_runner_test");
if (
  parsed.port !== "55464" ||
  parsed.pathname !== "/quorem_hono_runner_test" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
)
  throw new Error("Disposable runner database required");
describe.skipIf(!url)("lossless execution fixture", () => {
  const pool = createNodePool({
    connectionString: url!,
    max: 4,
    connectionTimeoutMs: 2000,
    idleTimeoutMs: 1000,
    onIdleError: () => {},
  });
  const run = <T>(fn: Parameters<typeof withNodeConnection<T>>[2]) =>
    withNodeConnection(pool, { lifetimeMs: 10000 }, fn);
  const id = crypto.randomUUID(),
    user = `raw-${id}`,
    problem = crypto.randomUUID(),
    version = crypto.randomUUID(),
    workspace = crypto.randomUUID(),
    submission = crypto.randomUUID(),
    job = crypto.randomUUID();
  beforeAll(async () => {
    await migrate(
      pool,
      "product",
      fileURLToPath(new URL("../../../../../migrations/", import.meta.url)),
    );
    const limits = {
      wallTimeMs: 2000,
      memoryBytes: 268435456,
      outputBytes: 65536,
      maxProcesses: 16,
      maxCollectionElements: 10000,
      maxNestingDepth: 100,
    };
    const fixture =
      '{"problem":{"examples":[{"args":[9007199254740993,"A\\u0000B"],"expected":9007199254740995}]},"hiddenCases":[]}';
    await pool.query("INSERT INTO users(id,display_name) VALUES($1,'Fixture')", [user]);
    await pool.query("INSERT INTO problems(id,slug) VALUES($1,$2)", [problem, problem]);
    await pool.query(
      "INSERT INTO problem_versions(id,version,problem_id,title,difficulty,statement_markdown,signature,constraints,limits,attribution,lossless_fixture) VALUES($1,1,$2,'Fixture','easy','','{}'::jsonb,'[]'::jsonb,$3::jsonb,'',$4)",
      [version, problem, JSON.stringify(limits), Buffer.from(fixture)],
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
      "INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES($1,$2,$3,'python')",
      [workspace, user, version],
    );
    await pool.query(
      "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases,lossless_cases) VALUES($1,$2,$3,'submit','x','hash','queued','[{\"args\":[1]}]'::jsonb,$4)",
      [
        submission,
        user,
        workspace,
        Buffer.from('[{"args":[9007199254740993,"X\\u0000Y"],"expected":9007199254740995}]'),
      ],
    );
    await pool.query(
      "INSERT INTO execution_jobs(id,submission_id,language,runtime_revision,harness_revision) VALUES($1,$2,'python','python-3.12-v1','quorem-harness-v2')",
      [job, submission],
    );
  });
  afterAll(async () => {
    await pool.query("DELETE FROM execution_jobs WHERE id=$1", [job]);
    await pool.query("DELETE FROM submissions WHERE id=$1", [submission]);
    await pool.query("DELETE FROM workspaces WHERE id=$1", [workspace]);
    await pool.query("DELETE FROM problem_examples WHERE version_id=$1", [version]);
    await pool.query("DELETE FROM problem_languages WHERE version_id=$1", [version]);
    await pool.query("DELETE FROM problem_versions WHERE id=$1", [version]);
    await pool.query("DELETE FROM problems WHERE id=$1", [problem]);
    await pool.query("DELETE FROM users WHERE id=$1", [user]);
    await pool.end();
  });
  it("gates old runners and loads exact cases and samples only for the live fence", async () => {
    const old = postgresClaims(run, {
      resumable: false,
      losslessCases: false,
      losslessResults: false,
    });
    expect(await old.claimAfterTeardown(false, "scope", null)).toBeNull();
    const capable = postgresClaims(run, {
        resumable: true,
        losslessCases: true,
        losslessResults: true,
      }),
      claimed = await capable.claimAfterTeardown(true, "scope", null);
    expect(claimed).not.toBeNull();
    const load = postgresExecutionLoad(run, true),
      result = await load(claimed!);
    expect(result.problemJson).toContain("9007199254740993");
    expect(result.problemJson).toContain("\\u0000");
    expect(result.cases[0]).toContain("9007199254740993");
    expect(result.cases[0]).toContain("\\u0000");
    expect(result.submitSamples[0]).toContain("9007199254740995");
    expect(result.privateDetails).toBe(false);
    await expect(load({ ...claimed!, sandboxScope: "other" })).rejects.toThrow();
    await expect(postgresExecutionLoad(run, false)(claimed!)).rejects.toThrow();
  });
});
