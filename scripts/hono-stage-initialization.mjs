/** Verify the migration-only retry state; caller separately verifies provider freshness. */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { stageDatabaseURL } from "./hono-stage-deploy-database.mjs";
import { stageRecoveryLockKey } from "./hono-stage-recovery-fence.mjs";
import { verifyCompleteHistory } from "../packages/database/src/migrations.ts";
import * as schema from "../packages/database/src/schema/index.ts";
const require = createRequire(new URL("../packages/database/package.json", import.meta.url));
const { Pool } = require("pg");
const { is } = require("drizzle-orm");
const { PgTable, isPgView, getTableConfig, getViewConfig } = require("drizzle-orm/pg-core");
const quote = (value) => `"${value.replaceAll('"', '""')}"`;
const expected = Object.entries(schema).flatMap(([name, definitions]) =>
  Object.values(definitions).flatMap((value) => {
    const namespace = name === "product" ? "public" : "quorem_auth";
    if (is(value, PgTable)) return [{ namespace, name: getTableConfig(value).name, kind: "r" }];
    if (isPgView(value)) return [{ namespace, name: getViewConfig(value).name, kind: "v" }];
    return [];
  }),
);
const product = fileURLToPath(new URL("../apps/api/migrations", import.meta.url));
const auth = fileURLToPath(new URL("../apps/auth/migrations", import.meta.url));

/** Safe diagnostic categories; never expose database errors. */
export class StageInitializationFailure extends Error {
  constructor(reason) {
    super(`Stage initialization refused: ${reason}`);
    this.name = "StageInitializationFailure";
    this.reason = reason;
  }
}
export async function requireInitializableStageDatabase(
  env,
  createPool = (url) => {
    const pool = new Pool({
      connectionString: url,
      max: 1,
      connectionTimeoutMillis: 5000,
      query_timeout: 12000,
    });
    pool.on("error", () => {});
    return pool;
  },
) {
  let pool,
    client,
    reason = "authority";
  try {
    pool = createPool(stageDatabaseURL(env));
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL transaction_timeout = '30s'");
    await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query("SET LOCAL lock_timeout = '2s'");
    reason = "lock";
    const lock = await client.query(
      "SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired",
      [stageRecoveryLockKey],
    );
    if (!lock.rows[0].acquired) throw new Error("Stage recovery is already running");
    await client.query("SELECT pg_advisory_xact_lock(740010)");
    await client.query("SELECT pg_advisory_xact_lock(714901, 1)");
    reason = "authority";
    const check = async () => {
      const result =
        await client.query(`SELECT current_database() AS database, current_user = session_user AS unswitched,
        has_database_privilege(current_user,current_database(),'CREATE') AND has_schema_privilege(current_user,'public','CREATE') AS migration_role,
        NOT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()) AS no_peers,
        NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname LIKE 'quorem\\_stage\\_runtime\\_%' ESCAPE '\\' AND rolcanlogin) AS no_runtime`);
      const row = result.rows[0];
      if (
        row.database !== "quorem_hono_stage" ||
        !row.unswitched ||
        !row.migration_role ||
        !row.no_peers ||
        !row.no_runtime
      )
        throw new Error("Stage initialization authority is not isolated");
    };
    await check();
    reason = "schema";
    const namespaces = (
      await client.query(
        "SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema') AND nspname NOT LIKE 'pg\\_%' ESCAPE '\\' ORDER BY 1",
      )
    ).rows.map((r) => r.nspname);
    if (namespaces.join(",") !== "public,quorem_auth") throw new Error("Unexpected stage schema");
    reason = "catalog";
    const actual = (
      await client.query(`SELECT n.nspname AS namespace,c.relname AS name,c.relkind AS kind,pg_get_userbyid(c.relowner)=current_user AS owned
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','quorem_auth') AND c.relkind IN ('r','p','v','m','f') ORDER BY 1,2`)
    ).rows;
    const key = (row) => `${row.namespace}.${row.name}:${row.kind}`;
    if (
      actual.some((row) => !row.owned) ||
      JSON.stringify(actual.map(key).sort()) !== JSON.stringify(expected.map(key).sort())
    )
      throw new Error("Unexpected stage catalog or ownership");
    reason = "lock";
    for (const table of expected
      .filter((row) => row.kind === "r")
      .sort((a, b) => key(a).localeCompare(key(b))))
      await client.query(`LOCK TABLE ${quote(table.namespace)}.${quote(table.name)} IN SHARE MODE`);
    reason = "history";
    await verifyCompleteHistory(client, "product", product);
    await verifyCompleteHistory(client, "auth", auth);
    reason = "data";
    for (const table of expected.filter(
      (row) => row.kind === "r" && row.name !== "schema_migrations",
    )) {
      const target = `${quote(table.namespace)}.${quote(table.name)}`;
      const query =
        table.namespace === "public" && table.name === "runner_input_gc_state"
          ? `SELECT count(*) = 1 AND bool_and(id = 1 AND cursor IS NULL) AS valid FROM ${target}`
          : `SELECT NOT EXISTS (SELECT 1 FROM ${target} LIMIT 1) AS valid`;
      if (!(await client.query(query)).rows[0].valid)
        throw new Error("Stage database contains application data");
    }
    reason = "authority";
    await check();
    await client.query("COMMIT");
    return { kind: "migrated-empty" };
  } catch {
    if (client) await client.query("ROLLBACK").catch(() => {});
    throw new StageInitializationFailure(reason);
  } finally {
    client?.release();
    await pool?.end();
  }
}
