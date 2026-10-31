/** Provision the isolated release login after migrations and before Hyperdrive. */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { stageDatabaseURL } from "./hono-stage-deploy-database.mjs";
const { Client, escapeIdentifier, escapeLiteral } = createRequire(
  new URL("../packages/database/package.json", import.meta.url),
)("pg");
const validPassword = (value) =>
  typeof value === "string" && value.length >= 32 && /^[\x21-\x7e]+$/.test(value);

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
    !validPassword(password)
  )
    throw new Error("Invalid isolated stage runtime credential");
  const runtime = new URL(operator);
  runtime.username = role;
  runtime.password = password;
  return { role, operator: operator.href, runtime: runtime.href, password };
}

// Both provisioning and rehearsal execute this exact transaction body.
async function configureStageRole(operator, role, password, setPhase) {
  const name = escapeIdentifier(role);
  setPhase("operator");
  const owner = (
    await operator.query("SELECT current_user AS name, current_database() AS database")
  ).rows[0];
  if (owner.database !== "quorem_hono_stage" || owner.name === role)
    throw new Error("Invalid migration operator");
  setPhase("create_role");
  if (!validPassword(password)) throw new Error("Invalid runtime credential");
  // Neon forwards role DDL at commit and rejects prehashed password values.
  await operator.query("SET LOCAL password_encryption='scram-sha-256'");
  await operator.query(
    `CREATE ROLE ${name} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${escapeLiteral(password)}`,
  );
  setPhase("database_grants");
  await operator.query("REVOKE CONNECT ON DATABASE quorem_hono_stage FROM PUBLIC");
  await operator.query(`GRANT CONNECT ON DATABASE quorem_hono_stage TO ${name}`);
  // Managed databases may grant CONNECT to shared groups independently of PUBLIC.
  const connected = await operator.query(
    `SELECT DISTINCT r.rolname AS name FROM pg_database d,
      LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a
      JOIN pg_roles r ON r.oid=a.grantee
      WHERE d.datname=current_database() AND a.privilege_type='CONNECT'
        AND r.rolname NOT IN(current_user,$1) ORDER BY r.rolname`,
    [role],
  );
  for (const row of connected.rows)
    await operator.query(
      `REVOKE CONNECT ON DATABASE quorem_hono_stage FROM ${escapeIdentifier(row.name)}`,
    );
  setPhase("schema_grants");
  await operator.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  await operator.query(`GRANT USAGE ON SCHEMA public, quorem_auth TO ${name}`);
  setPhase("object_grants");
  const objects =
    await operator.query(`SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('public','quorem_auth') AND c.relkind IN ('r','p','v','m','S')
        AND c.relname NOT IN ('schema_migrations','execution_attempt_inventory','stage_genesis')`);
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
  setPhase("boundary");
  const check = await operator.query(
    `SELECT r.rolcanlogin AND NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls) AS flags,
      NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) AS memberships,
      NOT has_schema_privilege(r.oid,'public','CREATE') AND NOT has_schema_privilege(r.oid,'quorem_auth','CREATE') AND NOT has_database_privilege(r.oid,current_database(),'CREATE') AS schema_safe,
      NOT EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname IN ('public','quorem_auth') AND pg_has_role(r.oid,n.nspowner,'USAGE')) AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','quorem_auth') AND pg_has_role(r.oid,p.proowner,'USAGE')) AS no_schema_function_ownership,
      NOT has_table_privilege(r.oid,'public.schema_migrations','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') AND NOT has_table_privilege(r.oid,'quorem_auth.schema_migrations','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') AS ledgers_safe,
      NOT has_any_column_privilege(r.oid,'public.execution_attempt_inventory','SELECT,INSERT,UPDATE,REFERENCES') AND NOT has_table_privilege(r.oid,'public.execution_attempt_inventory','DELETE,TRUNCATE,TRIGGER') AS inventory_safe,
      NOT has_any_column_privilege(r.oid,'public.stage_genesis','SELECT,INSERT,UPDATE,REFERENCES') AND NOT has_table_privilege(r.oid,'public.stage_genesis','DELETE,TRUNCATE,TRIGGER') AS genesis_safe,
      NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','quorem_auth') AND pg_has_role(r.oid,c.relowner,'USAGE')) AS no_ownership,
      EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='execution_jobs' AND t.tgname='execution_attempt_inventory_record' AND t.tgenabled='O' AND p.oid='public.record_execution_attempt()'::regprocedure AND p.prosecdef AND p.proowner=c.relowner AND NOT pg_has_role(r.oid,p.proowner,'USAGE')) AS trigger_safe,
      EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='execution_attempt_inventory' AND t.tgname='execution_attempt_inventory_immutable' AND t.tgenabled='O' AND p.oid='public.guard_execution_attempt_inventory()'::regprocedure AND NOT pg_has_role(r.oid,c.relowner,'USAGE')) AS inventory_guard_safe,
      NOT EXISTS (SELECT 1 FROM pg_roles x WHERE x.rolcanlogin AND NOT x.rolsuper AND x.rolname NOT IN (current_user,$1) AND has_database_privilege(x.oid,current_database(),'CONNECT')) AS connections_safe
      FROM pg_roles r WHERE r.rolname=$1`,
    [role],
  );
  const flags = check.rows[0] ?? {};
  if (Object.values(flags).some((value) => value !== true) || Object.keys(flags).length !== 11)
    throw Object.assign(new Error("Stage runtime privilege boundary failed"), {
      boundaryFlags: flags,
    });
  return flags;
}

const safeCode = (error) =>
  typeof error?.code === "string" && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : null;
const boundaryNames = [
  "flags",
  "memberships",
  "schema_safe",
  "no_schema_function_ownership",
  "ledgers_safe",
  "inventory_safe",
  "genesis_safe",
  "no_ownership",
  "trigger_safe",
  "inventory_guard_safe",
  "connections_safe",
];
const safeFlags = (value) =>
  Object.fromEntries(
    boundaryNames
      .filter((name) => typeof value?.[name] === "boolean")
      .map((name) => [name, value[name]]),
  );
export class StageRoleFailure extends Error {
  constructor(phase, error) {
    super("Stage runtime provisioning or validation failed");
    this.phase = [
      "operator_connect",
      "begin",
      "timeouts",
      "operator",
      "create_role",
      "database_grants",
      "schema_grants",
      "object_grants",
      "boundary",
      "commit",
      "runtime_login",
    ].includes(phase)
      ? phase
      : "unknown";
    this.code = safeCode(error);
    this.flags = safeFlags(error?.boundaryFlags);
    this.reason = [error?.message, error?.detail]
      .filter((value) => typeof value === "string")
      .join(" ")
      .replace(/(?:https?|postgres(?:ql)?):\/\/\S+/gi, "[redacted]")
      .replace(/[A-Za-z0-9_+/=.:-]{20,}/g, "[redacted]")
      .replace(/\S*(?:secret|token|password|credential)\S*/gi, "[redacted]")
      .replace(/\S+@\S+/g, "[redacted]")
      .replace(/\p{Cc}/gu, " ")
      .replace(/\s+/g, " ")
      .slice(0, 500);
  }
}

/** Exercise the exact role transaction, then roll it back without logging in. */
export async function rehearseStageRole(operator, role, password) {
  let phase = "begin",
    result;
  try {
    await operator.query("BEGIN");
    phase = "timeouts";
    await operator.query("SET LOCAL lock_timeout = '5s'");
    await operator.query("SET LOCAL statement_timeout = '15s'");
    const flags = await configureStageRole(operator, role, password, (next) => {
      phase = next;
    });
    result = { status: "accepted", phase: "boundary", code: null, flags: safeFlags(flags) };
  } catch (error) {
    result = {
      status: "rejected",
      phase,
      code: safeCode(error),
      flags: safeFlags(error?.boundaryFlags),
    };
  }
  // Rollback failure is never reported as a safe rehearsal result.
  try {
    await operator.query("ROLLBACK");
  } catch {
    throw new Error("Stage role rehearsal rollback unconfirmed");
  }
  return result;
}

/** Run only against an exclusively owned, freshly migrated stage database. */
export async function provisionStageRole(operator, runtime, role, password) {
  let phase = "begin";
  try {
    await operator.query("BEGIN");
    phase = "timeouts";
    await operator.query("SET LOCAL lock_timeout = '5s'");
    await operator.query("SET LOCAL statement_timeout = '15s'");
    await configureStageRole(operator, role, password, (next) => {
      phase = next;
    });
    phase = "commit";
    await operator.query("COMMIT");
    phase = "runtime_login";
    await runtime.connect();
    const login = await runtime.query(
      "SELECT current_user AS name, current_database() AS database",
    );
    if (login.rows[0]?.name !== role || login.rows[0]?.database !== "quorem_hono_stage")
      throw new Error("Stage runtime login mismatch");
  } catch (error) {
    await operator.query("ROLLBACK").catch(() => {});
    throw new StageRoleFailure(phase, error);
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
  } catch (error) {
    if (error instanceof StageRoleFailure) throw error;
    throw new StageRoleFailure("operator_connect", error);
  } finally {
    await operator.end();
  }
}
