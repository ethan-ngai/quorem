import { test } from "node:test";
import assert from "node:assert/strict";
import { requireFreshStageDatabase, stageDatabaseURL } from "./hono-stage-deploy-database.mjs";
const env = () => ({
  HONO_STAGE_DATABASE_URL:
    "postgres://fixture:fixture@db-stage.example.com:5432/quorem_hono_stage?sslmode=verify-full",
  TF_VAR_database_host: "db-stage.example.com",
  TF_VAR_database_port: "5432",
});
void test("requires exact dedicated database, configured host and verified TLS", () => {
  assert.ok(stageDatabaseURL(env()));
  for (const url of [
    "postgres://u:p@db-stage.example.com/quorem?sslmode=verify-full",
    "postgres://u:p@db-stage.example.com/quorem_hono_stage?sslmode=require",
    "postgres://u:p@other.example.com/quorem_hono_stage?sslmode=verify-full",
    "postgres://u:p@db-stage.example.com/quorem_hono_stage?sslmode=verify-full&host=localhost",
  ])
    assert.throws(() => stageDatabaseURL({ ...env(), HONO_STAGE_DATABASE_URL: url }));
});
void test("rejects existing objects, peers or insufficient migration privileges and closes pool", async () => {
  for (const patch of [
    {},
    { objects: 1 },
    { peers: 1 },
    { migration_role: false },
    { name: "quorem" },
  ]) {
    let closed = false;
    const run = requireFreshStageDatabase(env(), () => ({
      query: async () => ({
        rows: [{ name: "quorem_hono_stage", migration_role: true, objects: 0, peers: 0, ...patch }],
      }),
      end: async () => {
        closed = true;
      },
    }));
    if (Object.keys(patch).length) await assert.rejects(run);
    else await run;
    assert.equal(closed, true);
  }
});
