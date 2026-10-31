/** @file backfill-results.test.ts @description Disposable PostgreSQL operator command coverage. @module cli */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { createNodePool } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";

const execute = promisify(execFile);
const url = process.env.QUOREM_RESULT_BACKFILL_TEST_URL;
void test(
  "operator command normalizes retained results and statuses with audited bounded retries",
  { skip: !url },
  async () => {
    const parsed = new URL(url!);
    assert.equal(parsed.protocol, "postgres:");
    assert.equal(parsed.hostname, "127.0.0.1");
    assert.equal(parsed.pathname, "/quorem_hono_result_backfill_test");
    assert.equal(parsed.search, "");
    const pool = createNodePool({
      connectionString: url!,
      max: 3,
      connectionTimeoutMs: 3000,
      idleTimeoutMs: 5000,
      onIdleError: () => {},
    });
    const env = {
      ...process.env,
      QUOREM_OPERATOR_DATABASE_URL: url!,
      AUTH_ORIGIN: "https://backfill.test",
    };
    const cli = (args: string[], extra = {}) =>
      execute(process.execPath, [resolve("src/cli/backfill-results.ts"), ...args], {
        env: { ...env, ...extra },
      });
    const args = [
      "--op-id",
      "fixture-result-backfill",
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
        "INSERT INTO users(id,display_name,role) VALUES('operator','Operator','admin'),('owner','Owner','user')",
      );
      await pool.query(
        `INSERT INTO quorem_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES('subject','Operator','operator@example.test',true,clock_timestamp(),clock_timestamp())`,
      );
      await pool.query(
        "INSERT INTO identity_bindings(issuer,subject,user_id) VALUES('https://backfill.test','subject','operator')",
      );
      await pool.query(
        "INSERT INTO access_audit(operation_id,actor,user_id,action,scope,reason) VALUES('bootstrap:operator','fixture','operator','bootstrap','subject','fixture')",
      );
      const problem = crypto.randomUUID(),
        version = crypto.randomUUID(),
        workspace = crypto.randomUUID();
      await pool.query("INSERT INTO problems(id,slug) VALUES($1,'fixture')", [problem]);
      await pool.query(
        "INSERT INTO problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES($1,$2,1,'Fixture','easy','','{}','[]','{}','')",
        [version, problem],
      );
      await pool.query(
        "INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES($1,'python','','runtime','harness','')",
        [version],
      );
      await pool.query(
        "INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES($1,'owner',$2,'python')",
        [workspace, version],
      );
      const old = crypto.randomUUID(),
        side = crypto.randomUUID();
      await pool.query(
        "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases,result,result_payload) VALUES($1,'owner',$3,'run','','old','completed','[]','{}',convert_to($2,'UTF8'))",
        [
          old,
          JSON.stringify({ publicCases: [{ index: 7, status: "wrong\u0000answer", actual: 2 }] }),
          workspace,
        ],
      );
      await pool.query(
        "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) VALUES($1,'owner',$2,'run','','side','running','[]')",
        [side, workspace],
      );
      await pool.query(
        "INSERT INTO submission_result_headers(submission_id,header_data) VALUES($1,convert_to('{}','UTF8'))",
        [side],
      );
      await pool.query(
        "INSERT INTO submission_public_result_cases(submission_id,channel,ordinal,result_data) VALUES($1,'public',0,convert_to($2,'UTF8'))",
        [side, JSON.stringify({ index: 3, status: "accepted" })],
      );
      await pool.query("UPDATE submissions SET state='completed',result='{}' WHERE id=$1", [side]);
      await assert.rejects(cli([...args, "--dry-run"], { AUTH_ORIGIN: "https://wrong.test" }));
      await assert.rejects(cli(args));
      const dry = JSON.parse((await cli([...args, "--dry-run"])).stdout);
      assert.equal(dry.normalized, 1);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int n FROM submission_result_headers WHERE submission_id=$1",
            [old],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await pool.query("SELECT count(*)::int n FROM access_audit WHERE operation_id=$1", [
            args[1],
          ])
        ).rows[0].n,
        0,
      );
      await assert.rejects(cli([...args, "--legacy-drained"]), (error: any) => error.code === 2);
      const lock = await pool.connect();
      try {
        await lock.query("BEGIN");
        await lock.query("SELECT id FROM submissions WHERE id=$1 FOR UPDATE", [side]);
        await assert.rejects(
          cli([...args, "--legacy-drained"]),
          (error: any) => error.code === 2 && !JSON.parse(error.stdout).complete,
        );
      } finally {
        await lock.query("ROLLBACK");
        lock.release();
      }
      await assert.rejects(cli([...args, "--legacy-drained"]), (error: any) => error.code === 2);
      const done = JSON.parse((await cli([...args, "--legacy-drained"])).stdout);
      assert.equal(done.complete, true);
      const rows = (
        await pool.query(
          "SELECT case_index,convert_from(status_json,'UTF8') status FROM submission_public_case_statuses ORDER BY case_index",
        )
      ).rows;
      assert.deepEqual(
        rows.map((r) => [r.case_index, JSON.parse(r.status)]),
        [
          [3, "accepted"],
          [7, "wrong\u0000answer"],
        ],
      );
      assert.equal(
        (
          await pool.query("SELECT count(*)::int n FROM access_audit WHERE operation_id=$1", [
            args[1],
          ])
        ).rows[0].n,
        1,
      );
      await assert.rejects(cli(["--op-id", args[1], "--reason", "changed", "--legacy-drained"]));
      const malformed = crypto.randomUUID();
      await pool.query(
        "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases,result,result_payload) VALUES($1,'owner',$2,'run','','bad','completed','[]','{}',convert_to('{bad','UTF8'))",
        [malformed, workspace],
      );
      await assert.rejects(
        cli(["--op-id", "malformed", "--reason", "fixture", "--legacy-drained"]),
        (error: any) =>
          error.code === 1 &&
          JSON.parse(error.stdout).outcomeUnknown === true &&
          !error.stdout.includes("{bad"),
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int n FROM submission_result_headers WHERE submission_id=$1",
            [malformed],
          )
        ).rows[0].n,
        0,
      );
      await pool.query("UPDATE submissions SET result=NULL,result_payload=NULL WHERE id=$1", [
        malformed,
      ]);
      await pool.query(`UPDATE quorem_auth."user" SET "emailVerified"=false WHERE id='subject'`);
      await assert.rejects(cli([...args, "--legacy-drained"]));
      await pool.query(`UPDATE quorem_auth."user" SET "emailVerified"=true WHERE id='subject'`);
      await pool.query("UPDATE users SET disabled=true WHERE id='operator'");
      await assert.rejects(cli([...args, "--legacy-drained"]));
    } finally {
      await pool.end();
    }
  },
);
