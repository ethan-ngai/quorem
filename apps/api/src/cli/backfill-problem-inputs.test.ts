/** @file backfill-problem-inputs.test.ts @description Disposable version-index backfill coverage. @module cli */
import { test, expect } from "vitest";
import { resolve } from "node:path";
import { createNodePool } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";
import { backfillProblemInputs, ProblemInputsIncomplete } from "./backfill-problem-inputs.ts";

test("indexes historical published versions in audited resumable batches", async () => {
  const url = process.env.QUOREM_PROBLEM_INPUT_TEST_URL;
  if (!url) throw new Error("Disposable database required");
  const parsed = new URL(url);
  if (
    parsed.hostname !== "127.0.0.1" ||
    parsed.pathname !== "/quorem_hono_problem_input_test" ||
    parsed.search
  )
    throw new Error("Unsafe database");
  const pool = createNodePool({
    connectionString: url,
    max: 3,
    connectionTimeoutMs: 5000,
    idleTimeoutMs: 5000,
    onIdleError: () => {},
  });
  process.env.QUOREM_OPERATOR_DATABASE_URL = url;
  process.env.AUTH_ORIGIN = "https://backfill.test";
  const args = [
    "--op-id",
    "test-inputs",
    "--reason",
    "fixture",
    "--limit",
    "1",
    "--max-batches",
    "1",
  ];
  try {
    await migrate(pool, "product", resolve("migrations"));
    await migrate(pool, "auth", resolve("../auth/migrations"));
    await pool.query(
      "INSERT INTO users(id,display_name,role) VALUES('operator','Operator','admin')",
    );
    await pool.query(
      `INSERT INTO quorem_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES('subject','Operator','operator@fixture.test',true,now(),now())`,
    );
    await pool.query(
      "INSERT INTO identity_bindings(issuer,subject,user_id) VALUES('https://backfill.test','subject','operator')",
    );
    await pool.query(
      "INSERT INTO access_audit(operation_id,actor,user_id,action,scope,reason) VALUES('bootstrap:operator','fixture','operator','bootstrap','subject','fixture')",
    );
    const problem = crypto.randomUUID(),
      v1 = crypto.randomUUID(),
      v2 = crypto.randomUUID();
    await pool.query("INSERT INTO problems(id,slug) VALUES($1,'backfill-fixture')", [problem]);
    await pool.query(
      "INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES($1,$3,1,'A','easy','','{}','[]','{}',''),($2,$3,2,'B','easy','','{}','[]','{}','')",
      [v1, v2, problem],
    );
    await pool.query(
      "INSERT INTO problem_test_cases(version_id,ordinal,args,expected) VALUES($1,0,'[2]','3'),($2,0,'[4]','5')",
      [v1, v2],
    );
    await pool.query("UPDATE problem_versions SET sealed=true WHERE id=ANY($1::uuid[])", [
      [v1, v2],
    ]);
    await expect(backfillProblemInputs(args)).rejects.toThrow(/Drain legacy/);
    process.env.AUTH_ORIGIN = "https://untrusted.test";
    await expect(backfillProblemInputs([...args, "--legacy-drained"])).rejects.toBeInstanceOf(
      ProblemInputsIncomplete,
    );
    process.env.AUTH_ORIGIN = "https://backfill.test";
    expect(await backfillProblemInputs([...args, "--dry-run"])).toMatchObject({
      completed: 1,
      complete: false,
      dryRun: true,
    });
    expect(
      Number((await pool.query("SELECT count(*) FROM runner_version_inputs")).rows[0].count),
    ).toBe(0);
    expect(await backfillProblemInputs([...args, "--legacy-drained"])).toMatchObject({
      completed: 1,
      complete: false,
    });
    expect(await backfillProblemInputs([...args, "--legacy-drained"])).toMatchObject({
      completed: 1,
      complete: true,
    });
    expect(await backfillProblemInputs([...args, "--legacy-drained"])).toMatchObject({
      completed: 0,
      complete: true,
    });
    expect(
      Number(
        (await pool.query("SELECT count(*) FROM runner_version_input_cases WHERE channel='hidden'"))
          .rows[0].count,
      ),
    ).toBe(2);
    await expect(
      backfillProblemInputs([...args, "--legacy-drained", "--reason", "changed"]),
    ).rejects.toBeInstanceOf(ProblemInputsIncomplete);
    const lossless = crypto.randomUUID();
    await pool.query(
      "INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution,lossless_fixture) VALUES($1,$2,3,'C','easy','','{}','[]','{}','',convert_to($3,'UTF8'))",
      [
        lossless,
        problem,
        JSON.stringify({
          problem: { id: lossless, signature: {}, constraints: [], limits: {}, examples: [] },
          hiddenCases: [{ args: ["a\u0000b"], expected: 17 }],
          odysseyHiddenCases: [],
        }),
      ],
    );
    await pool.query("UPDATE problem_versions SET sealed=true WHERE id=$1", [lossless]);
    expect(await backfillProblemInputs([...args, "--legacy-drained"])).toMatchObject({
      completed: 1,
      complete: true,
    });
    const data = (
      await pool.query(
        "SELECT convert_from(b.data,'UTF8') AS data FROM runner_version_input_cases c JOIN runner_input_blobs b ON b.hash=c.blob_hash WHERE c.version_id=$1",
        [lossless],
      )
    ).rows[0].data;
    expect(JSON.parse(data).args).toEqual(["a\u0000b"]);
    const oversized = crypto.randomUUID();
    await pool.query(
      "INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution,lossless_fixture) VALUES($1,$2,4,'D','easy','','{}','[]','{}','',convert_to(repeat('a',16777217),'UTF8'))",
      [oversized, problem],
    );
    await pool.query("UPDATE problem_versions SET sealed=true WHERE id=$1", [oversized]);
    await expect(backfillProblemInputs([...args, "--legacy-drained"])).rejects.toBeInstanceOf(
      ProblemInputsIncomplete,
    );
    expect(
      (await pool.query("SELECT 1 FROM runner_version_inputs WHERE version_id=$1", [oversized]))
        .rowCount,
    ).toBe(0);
    expect(
      Number(
        (await pool.query("SELECT count(*) FROM access_audit WHERE operation_id='test-inputs'"))
          .rows[0].count,
      ),
    ).toBe(1);
  } finally {
    await pool.end();
  }
});
