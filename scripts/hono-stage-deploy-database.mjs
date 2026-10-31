/** Require a fresh, isolated stage database before any stage cloud mutation. */
import { createRequire } from "node:module";
const { Pool } = createRequire(new URL("../packages/database/package.json", import.meta.url))("pg");

export function stageDatabaseURL(env) {
  let url;
  try {
    url = new URL(env.HONO_STAGE_DATABASE_URL);
  } catch {
    throw new Error("Invalid stage database URL");
  }
  const keys = [...url.searchParams.keys()];
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname !== env.TF_VAR_database_host ||
    (url.port || "5432") !== String(env.TF_VAR_database_port) ||
    url.pathname !== "/quorem_hono_stage" ||
    !url.username ||
    !url.password ||
    url.hash ||
    keys.length !== 1 ||
    keys[0] !== "sslmode" ||
    url.searchParams.get("sslmode") !== "verify-full"
  )
    throw new Error("Isolated TLS-verified stage database required");
  return url.href;
}
export async function requireFreshStageDatabase(
  env,
  createPool = (connectionString) =>
    new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 }),
) {
  const connectionString = stageDatabaseURL(env);
  const pool = createPool(connectionString);
  try {
    const result = await pool.query(`SELECT current_database() AS name,
      has_database_privilege(current_user,current_database(),'CREATE') AND has_schema_privilege(current_user,'public','CREATE') AS migration_role,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')) AS objects,
      (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()) AS peers`);
    const row = result.rows[0];
    if (
      row?.name !== "quorem_hono_stage" ||
      row.migration_role !== true ||
      row.objects !== 0 ||
      row.peers !== 0
    )
      throw new Error("Stage database is not fresh or migration role is insufficient");
  } finally {
    await pool.end();
  }
}
