/** Provision the isolated release login after migrations and before Hyperdrive. */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { stageDatabaseURL } from "./hono-stage-deploy-database.mjs";
const { Client, escapeIdentifier, escapeLiteral } = createRequire(
  new URL("../packages/database/package.json", import.meta.url),
)("pg");

/** A release may never reuse a previously fenced generation's login. */
export function deriveStageRole(release, rawGeneration = "1") {
  if (
    !/^[a-f0-9]{40}$/.test(release ?? "") ||
    typeof rawGeneration !== "string" ||
    !/^[1-9][0-9]*$/.test(rawGeneration)
  )
    throw new Error("Invalid staged release generation");
  const generation = Number(rawGeneration);
  if (!Number.isSafeInteger(generation)) throw new Error("Invalid staged release generation");
  return `quorem_stage_runtime_${createHash("sha256")
    .update(JSON.stringify([release, generation]))
    .digest("hex")
    .slice(0, 32)}`;
}

export function stageRoleCredentials(env) {
  const operator = new URL(stageDatabaseURL(env));
  const role = deriveStageRole(env.HONO_RELEASE_SHA, env.TF_VAR_release_generation ?? "1");
  const password = env.TF_VAR_database_password;
  if (
    !/^[a-f0-9]{40}$/.test(env.HONO_RELEASE_SHA ?? "") ||
    (env.TF_VAR_database_user !== undefined && env.TF_VAR_database_user !== role) ||
    decodeURIComponent(operator.username) === role ||
    decodeURIComponent(operator.password) === password ||
    typeof password !== "string" ||
    password.length < 32 ||
    !/^[\x21-\x7e]+$/.test(password)
  )
    throw new Error("Invalid isolated stage runtime credential");
  const runtime = new URL(operator);
  runtime.username = role;
  runtime.password = password;
  return { role, operator: operator.href, runtime: runtime.href, password };
}

/** PostgreSQL SCRAM verifier; ASCII input avoids differing SASLprep normalization. */
export function stageScramVerifier(password, salt = randomBytes(16)) {
  if (
    typeof password !== "string" ||
    password.length < 32 ||
    !/^[\x21-\x7e]+$/.test(password) ||
    salt.length !== 16
  )
    throw new Error("Invalid runtime credential");
  const salted = pbkdf2Sync(password, salt, 4096, 32, "sha256");
  const client = createHmac("sha256", salted).update("Client Key").digest();
  const stored = createHash("sha256").update(client).digest("base64");
  const server = createHmac("sha256", salted).update("Server Key").digest("base64");
  return `SCRAM-SHA-256$4096:${salt.toString("base64")}$${stored}:${server}`;
}

/** Run only against an exclusively owned, freshly migrated stage database. */
export async function provisionStageRole(operator, runtime, role, password) {
  const name = escapeIdentifier(role);
  try {
    await operator.query("BEGIN");
    await operator.query("SET LOCAL lock_timeout = '5s'");
    await operator.query("SET LOCAL statement_timeout = '15s'");
    const owner = (
      await operator.query("SELECT current_user AS name, current_database() AS database")
    ).rows[0];
    if (owner.database !== "quorem_hono_stage" || owner.name === role)
      throw new Error("Invalid migration operator");
    await operator.query(
      `CREATE ROLE ${name} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${escapeLiteral(stageScramVerifier(password))}`,
    );
    await operator.query("REVOKE CONNECT ON DATABASE quorem_hono_stage FROM PUBLIC");
    await operator.query(`GRANT CONNECT ON DATABASE quorem_hono_stage TO ${name}`);
    await operator.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    await operator.query(`GRANT USAGE ON SCHEMA public, quorem_auth TO ${name}`);
    const objects =
      await operator.query(`SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','quorem_auth') AND c.relkind IN ('r','p','v','m','S')
        AND c.relname NOT IN ('schema_migrations','execution_attempt_inventory')`);
    for (const item of objects.rows) {
      const target = `${escapeIdentifier(item.schema)}.${escapeIdentifier(item.name)}`;
      const privilege =
        item.kind === "S"
          ? "USAGE, SELECT"
          : ["v", "m"].includes(item.kind)
            ? "SELECT"
            : "SELECT, INSERT, UPDATE, DELETE";
      await operator.query(
        `GRANT ${privilege} ON ${item.kind === "S" ? "SEQUENCE" : "TABLE"} ${target} TO ${name}`,
      );
    }
    const check = await operator.query(
      `SELECT r.rolcanlogin AND NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls) AS flags,
      NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS memberships,
      NOT has_schema_privilege(r.oid,'public','CREATE') AND NOT has_schema_privilege(r.oid,'quorem_auth','CREATE') AND NOT has_database_privilege(r.oid,current_database(),'CREATE') AS schema_safe,
      NOT EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname IN ('public','quorem_auth') AND pg_has_role(r.oid,n.nspowner,'USAGE')) AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','quorem_auth') AND pg_has_role(r.oid,p.proowner,'USAGE')) AS no_schema_function_ownership,
      NOT has_table_privilege(r.oid,'public.schema_migrations','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') AND NOT has_table_privilege(r.oid,'quorem_auth.schema_migrations','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') AS ledgers_safe,
      NOT has_any_column_privilege(r.oid,'public.execution_attempt_inventory','SELECT,INSERT,UPDATE,REFERENCES') AND NOT has_table_privilege(r.oid,'public.execution_attempt_inventory','DELETE,TRUNCATE,TRIGGER') AS inventory_safe,
      NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','quorem_auth') AND pg_has_role(r.oid,c.relowner,'USAGE')) AS no_ownership,
      EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='execution_jobs' AND t.tgname='execution_attempt_inventory_record' AND t.tgenabled='O' AND p.oid='public.record_execution_attempt()'::regprocedure AND p.prosecdef AND p.proowner=c.relowner AND NOT pg_has_role(r.oid,p.proowner,'USAGE')) AS trigger_safe,
      EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='execution_attempt_inventory' AND t.tgname='execution_attempt_inventory_immutable' AND t.tgenabled='O' AND p.oid='public.guard_execution_attempt_inventory()'::regprocedure AND NOT pg_has_role(r.oid,c.relowner,'USAGE')) AS inventory_guard_safe,
      NOT EXISTS (SELECT 1 FROM pg_roles x WHERE x.rolcanlogin AND NOT x.rolsuper AND x.rolname NOT IN (current_user,$1) AND has_database_privilege(x.oid,current_database(),'CONNECT')) AS connections_safe
      FROM pg_roles r WHERE r.rolname=$1`,
      [role],
    );
    if (!check.rows[0] || Object.values(check.rows[0]).some((value) => value !== true))
      throw new Error("Stage runtime privilege boundary failed");
    await operator.query("COMMIT");
    await runtime.connect();
    const login = await runtime.query(
      "SELECT current_user AS name, current_database() AS database",
    );
    if (login.rows[0]?.name !== role || login.rows[0]?.database !== "quorem_hono_stage")
      throw new Error("Stage runtime login mismatch");
  } catch {
    await operator.query("ROLLBACK").catch(() => {});
    throw new Error("Stage runtime provisioning or validation failed");
  } finally {
    await runtime.end().catch(() => {});
  }
}

export async function provisionStageDatabaseRole(env) {
  const creds = stageRoleCredentials(env);
  const operator = new Client({
    connectionString: creds.operator,
    connectionTimeoutMillis: 5000,
    query_timeout: 15000,
  });
  const runtime = new Client({
    connectionString: creds.runtime,
    connectionTimeoutMillis: 5000,
    query_timeout: 15000,
  });
  try {
    await operator.connect();
    await provisionStageRole(operator, runtime, creds.role, creds.password);
  } finally {
    await operator.end();
  }
}
