import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { withDisposablePostgres } from "./hono-disposable-postgres.mjs";
import { provisionStageRole } from "./hono-stage-database-role.mjs";
import { fenceStageRuntime } from "./hono-stage-recovery-fence.mjs";
import { lockEmptyStage, validateResetPlan } from "./hono-stage-reset.mjs";
import { bindJobInputs } from "../apps/api/src/adapters/postgres/judging/inputs/bind.ts";
import { seedCatalog } from "../apps/api/src/cli/seed.ts";
const { Client, Pool } = createRequire(
  new URL("../packages/database/package.json", import.meta.url),
)("pg");
void test("only explicitly allowed deletions can be applied", () => {
  const plan = (address, actions) => ({ resource_changes: [{ address, change: { actions } }] });
  assert.doesNotThrow(() =>
    validateResetPlan(plan("cloudflare_worker.api", ["delete"]), /^cloudflare_worker\.api$/),
  );
  assert.throws(() =>
    validateResetPlan(plan("cloudflare_queue.execution", ["delete"]), /^cloudflare_worker\.api$/),
  );
  assert.throws(() =>
    validateResetPlan(
      plan("cloudflare_worker.api", ["delete", "create"]),
      /^cloudflare_worker\.api$/,
    ),
  );
});
void test(
  "real migrated stage requires fenced writer, matching genesis and no application data",
  { timeout: 120000 },
  async () => {
    await withDisposablePostgres(
      { prefix: "quorem-stage-reset", port: 55716, database: "quorem_hono_stage" },
      async ({ url, run }) => {
        for (const [owner, dir] of [
          ["product", "apps/api/migrations"],
          ["auth", "apps/auth/migrations"],
        ])
          await run(
            process.execPath,
            ["--experimental-strip-types", "packages/database/src/migrate.ts", owner, dir],
            { env: { ...process.env, DATABASE_URL: url } },
          );
        const client = new Client({ connectionString: url });
        await client.connect();
        const role = "quorem_stage_runtime_" + "a".repeat(32),
          password = "fixture-password-with-at-least-32-characters",
          runtimeURL = new URL(url);
        runtimeURL.username = role;
        runtimeURL.password = password;
        try {
          await provisionStageRole(
            client,
            new Client({ connectionString: runtimeURL.href }),
            role,
            password,
          );
          const namespace = "1".repeat(64),
            databaseIdentity = "project:branch:quorem_hono_stage";
          await client.query(
            "INSERT INTO stage_genesis(database_identity,namespace,scope,initial_operation,initial_release,initial_bindings,owner_key_sha256,genesis_envelope,migration_062_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,'{}',$8)",
            [
              databaseIdentity,
              namespace,
              `remote:${"2".repeat(64)}`,
              "00000000-0000-4000-8000-000000000001",
              "3".repeat(40),
              "4".repeat(64),
              "5".repeat(64),
              "6".repeat(64),
            ],
          );
          const binding = { role, namespace, databaseIdentity };
          await assert.rejects(lockEmptyStage(client, binding), /enabled/);
          await fenceStageRuntime(client, role);
          await assert.rejects(
            lockEmptyStage(client, { ...binding, namespace: "8".repeat(64) }),
            /mismatched genesis/,
          );
          await lockEmptyStage(client, binding);
          await client.query("ROLLBACK");
          const pool = new Pool({ connectionString: url });
          try {
            await seedCatalog(pool, false);
          } finally {
            await pool.end();
          }
          const subject = "stage-fixture-00000000-0000-4000-8000-000000000001",
            user = "00000000-0000-4000-8000-000000000002";
          await client.query(
            `INSERT INTO quorem_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$1||'@example.test',true,now(),now())`,
            [subject],
          );
          await client.query("INSERT INTO users(id,display_name) VALUES($1,'Fixture')", [user]);
          await client.query(
            "INSERT INTO identity_bindings(issuer,subject,user_id) VALUES('https://hono-stage.quorem.app',$1,$2)",
            [subject, user],
          );
          const workspace = "00000000-0000-4000-8000-000000000003",
            submission = "00000000-0000-4000-8000-000000000004";
          await client.query(
            "INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES($1,$2,'e91ec728-4597-5dfb-9d19-7c4ba17138b7','python')",
            [workspace, user],
          );
          await client.query(
            "INSERT INTO submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases) VALUES($1,$2,$3,'submit','fixture','fixture','queued','[]')",
            [submission, user, workspace],
          );
          await client.query(
            "INSERT INTO quorem_auth.rate_limit(bucket,used,expires_at) VALUES('fixture-token',1,now()+interval '1 minute')",
          );
          const job = "00000000-0000-4000-8000-000000000005";
          await client.query("INSERT INTO execution_jobs(id,submission_id) VALUES($1,$2)", [
            job,
            submission,
          ]);
          const { drizzle } = createRequire(
            new URL("../packages/database/package.json", import.meta.url),
          )("drizzle-orm/node-postgres");
          const version = "e91ec728-4597-5dfb-9d19-7c4ba17138b7";
          const cases = Number(
            (
              await client.query(
                "SELECT count(*) FROM runner_version_input_cases WHERE version_id=$1 AND channel='example'",
                [version],
              )
            ).rows[0].count,
          );
          await drizzle(client).transaction((tx) =>
            bindJobInputs(tx, {
              jobId: job,
              owner: { version },
              level: 0,
              primary: "example",
              custom: [],
              caseCount: cases,
              sampleCount: 0,
              privateDetails: false,
              submitCasesAreSamples: false,
            }),
          );
          await assert.rejects(lockEmptyStage(client, binding), /contains data/);
          await lockEmptyStage(client, { ...binding, allowFixtures: true });
          await client.query("ROLLBACK");
          await client.query(
            `INSERT INTO quorem_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES('real-user','real','real@example.test',true,now(),now())`,
          );
          await assert.rejects(
            lockEmptyStage(client, { ...binding, allowFixtures: true }),
            /non-fixture/,
          );
          await client.query(`DELETE FROM quorem_auth."user" WHERE id='real-user'`);
          await client.query(
            "INSERT INTO users(id,display_name) VALUES('unexpected','Unexpected')",
          );
          await assert.rejects(lockEmptyStage(client, binding), /contains data/);
        } finally {
          await client.end();
        }
      },
    );
  },
);
