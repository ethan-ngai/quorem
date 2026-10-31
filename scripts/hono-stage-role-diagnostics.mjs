/** Stage inspection and rollback rehearsal; emit fixed fields, never credentials/provider payloads. */
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveStageRole,
  rehearseStageRole,
  provisionStageDatabaseRole,
  StageRoleFailure,
} from "./hono-stage-database-role.mjs";
import { fenceStageRuntime } from "./hono-stage-recovery-fence.mjs";
import { terraformInitArgs } from "./hono-stage-deploy.mjs";
import { runStageCommand } from "./hono-stage-launch.mjs";
import {
  requireInitializableStageDatabase,
  StageInitializationFailure,
} from "./hono-stage-initialization.mjs";

export async function diagnoseStageRole(client, role) {
  if (!/^quorem_stage_runtime_[a-f0-9]{32}$/.test(role)) throw new Error("Invalid runtime role");
  await client.query("BEGIN READ ONLY");
  let begun = true;
  try {
    await client.query("SET LOCAL statement_timeout='5s'");
    await client.query("SET LOCAL lock_timeout='1s'");
    const identity = (
      await client.query(`SELECT current_database()='quorem_hono_stage' AS isolated,
      current_user=session_user AS unswitched FROM pg_roles WHERE rolname=current_user`)
    ).rows[0];
    if (!identity?.isolated || !identity.unswitched) throw new Error("Invalid staged operator");
    const flags = (
      await client.query(`SELECT rolcreaterole AS create_role, rolcreatedb AS create_database,
      rolsuper AS superuser, rolbypassrls AS bypass_rls,
      pg_has_role(current_user,'pg_signal_backend','USAGE') AS signal_backend,
      pg_has_role(current_user,'pg_read_all_stats','USAGE') AS read_stats,
      has_schema_privilege(current_user,'public','CREATE') AS schema_create
      FROM pg_roles WHERE rolname=current_user`)
    ).rows[0];
    const runtime = (
      await client.query(
        `SELECT rolcanlogin AS login, rolsuper AS superuser,
      rolcreatedb AS create_database, rolcreaterole AS create_role, rolreplication AS replication,
      rolbypassrls AS bypass_rls,
      (SELECT count(*)::int FROM pg_auth_members WHERE member=r.oid) AS inherited_roles,
      has_database_privilege(r.oid,current_database(),'CONNECT') AS database_connect,
      has_schema_privilege(r.oid,'public','CREATE') AS schema_create
      FROM pg_roles r WHERE rolname=$1`,
        [role],
      )
    ).rows[0];
    const counts = (
      await client.query(
        `SELECT
      (SELECT count(*)::int FROM pg_roles r WHERE rolcanlogin AND NOT rolsuper AND rolname NOT IN(current_user,$1)
       AND has_database_privilege(r.oid,current_database(),'CONNECT')) AS other_connect_logins,
      (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()) AS other_sessions,
      (SELECT count(*)::int FROM public.schema_migrations) AS product_migrations,
      to_regclass('public.stage_genesis') IS NOT NULL AS genesis_table
    `,
        [role],
      )
    ).rows[0];
    await client.query("COMMIT");
    begun = false;
    const project = (row, names) =>
      Object.fromEntries(
        names.map((key) => {
          const value = row?.[key];
          return [
            key,
            typeof value === "boolean" ||
            (Number.isSafeInteger(value) && value >= 0 && value <= 10000000)
              ? value
              : null,
          ];
        }),
      );
    return {
      operator: project(flags, [
        "create_role",
        "create_database",
        "superuser",
        "bypass_rls",
        "signal_backend",
        "read_stats",
        "schema_create",
      ]),
      runtimeExists: !!runtime,
      runtime: project(runtime, [
        "login",
        "superuser",
        "create_database",
        "create_role",
        "replication",
        "bypass_rls",
        "inherited_roles",
        "database_connect",
        "schema_create",
      ]),
      database: project(counts, [
        "other_connect_logins",
        "other_sessions",
        "product_migrations",
        "genesis_table",
      ]),
    };
  } finally {
    if (begun) await client.query("ROLLBACK").catch(() => {});
  }
}

export async function inspectStageRole(env) {
  if (
    env.GITHUB_REF !== "refs/heads/feat/hono-migration" ||
    env.HONO_RELEASE_SHA !== env.GITHUB_SHA ||
    !/^[a-f0-9]{40}$/.test(env.HONO_RELEASE_SHA ?? "") ||
    !/^[a-f0-9]{40}$/.test(env.HONO_DIAGNOSE_RELEASE_SHA ?? "")
  )
    throw new Error("Exact migration workflow and target release required");
  runStageCommand("terraform", terraformInitArgs(env, "hono-bootstrap"), env);
  const saved = JSON.parse(
    runStageCommand("terraform", ["-chdir=infra/terraform/hono-bootstrap", "output", "-json"], env),
  );
  const url = new URL(saved.database_url?.value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.pathname !== "/quorem_hono_stage" ||
    url.searchParams.get("sslmode") !== "verify-full" ||
    !url.username ||
    !url.password ||
    url.hash
  )
    throw new Error("Invalid stage database");
  const { Client } = createRequire(new URL("../packages/database/package.json", import.meta.url))(
    "pg",
  );
  const options = {
    connectionString: url.href,
    connectionTimeoutMillis: 5000,
    query_timeout: 7000,
  };
  const client = new Client(options);
  client.on("error", () => {});
  const role = deriveStageRole(env.HONO_DIAGNOSE_RELEASE_SHA, "1");
  const action = env.HONO_STAGE_INSPECTION_ACTION ?? "diagnose";
  if (!["diagnose", "rehearse-role", "probe-role"].includes(action))
    throw new Error("Invalid role inspection action");
  const password = saved.stage_secrets?.value?.STAGE_RUNTIME_DATABASE_PASSWORD;
  if (["rehearse-role", "probe-role"].includes(action)) {
    if (!/^[a-f0-9]{64}$/.test(password ?? ""))
      throw new Error("Invalid staged runtime credential");
    const child = Object.fromEntries(
      ["PATH", "HOME", "USER", "TMPDIR", "CI"]
        .filter((name) => env[name] !== undefined)
        .map((name) => [name, env[name]]),
    );
    child.DATABASE_URL = url.href;
    for (const [owner, directory] of [
      ["product", "apps/api/migrations"],
      ["auth", "apps/auth/migrations"],
    ])
      runStageCommand(
        "vp",
        ["exec", "node", "packages/database/src/migrate.ts", owner, directory],
        child,
      );
  }
  let closed = false;
  try {
    await client.connect();
    const before = await diagnoseStageRole(client, role);
    if (action === "probe-role") {
      if (before.runtimeExists) throw new Error("Probe role already exists");
      await client.end();
      closed = true;
      let provision;
      try {
        await provisionStageDatabaseRole({
          HONO_RELEASE_SHA: env.HONO_DIAGNOSE_RELEASE_SHA,
          HONO_STAGE_DATABASE_URL: url.href,
          TF_VAR_database_host: url.hostname,
          TF_VAR_database_port: url.port || "5432",
          TF_VAR_database_password: password,
          TF_VAR_release_generation: "1",
        });
        provision = { status: "accepted" };
      } catch (error) {
        if (!(error instanceof StageRoleFailure)) throw error;
        provision = {
          status: "rejected",
          phase: error.phase,
          code: error.code,
          flags: error.flags,
        };
      }
      const inspector = new Client(options);
      inspector.on("error", () => {});
      try {
        await inspector.connect();
        let after = await diagnoseStageRole(inspector, role);
        let containment = "role-absent";
        if (after.runtimeExists) {
          try {
            await fenceStageRuntime(inspector, role);
            containment = "fenced";
          } catch {
            containment = "unconfirmed";
          }
          after = await diagnoseStageRole(inspector, role);
        }
        return { before, provision, containment, after };
      } finally {
        await inspector.end().catch(() => {});
      }
    }
    if (action === "diagnose") {
      await client.end();
      closed = true;
      let initialization;
      try {
        initialization = await requireInitializableStageDatabase({
          HONO_STAGE_DATABASE_URL: url.href,
          TF_VAR_database_host: url.hostname,
          TF_VAR_database_port: url.port || "5432",
        });
      } catch (error) {
        if (!(error instanceof StageInitializationFailure)) throw error;
        initialization = { refused: error.reason };
      }
      return { ...before, initialization };
    }
    const rehearsal = await rehearseStageRole(client, role, password);
    return { before, rehearsal, after: await diagnoseStageRole(client, role) };
  } finally {
    if (!closed) await client.end().catch(() => {});
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${JSON.stringify(await inspectStageRole(process.env))}\n`);
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ error: "stage-role-inspection", code: /^[A-Z0-9]{5}$/.test(error?.code ?? "") ? error.code : null })}\n`,
    );
    process.exitCode = 1;
  }
}
