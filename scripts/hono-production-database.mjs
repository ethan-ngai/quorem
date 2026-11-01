/** Transition the existing production database after externally confirmed legacy shutdown. */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { migrate } from "../packages/database/src/migrations.ts";
import { runMigrationBaseline } from "../apps/api/src/cli/migration-baseline.ts";
import { verifiedOperator } from "../apps/api/src/cli/operator-backfill.ts";
import { operatorDatabaseIdentity } from "../apps/api/src/cli/operator-database.ts";
import { configureRestrictedRole } from "./hono-stage-database-role.mjs";

const { drizzle } = createRequire(new URL("../apps/api/package.json", import.meta.url))(
  "drizzle-orm/node-postgres",
);
const { Client, Pool } = createRequire(
  new URL("../packages/database/package.json", import.meta.url),
)("pg");
const root = fileURLToPath(new URL("../", import.meta.url));
const op = (seed, label) => {
  const bytes = createHash("sha256").update(`${seed}:${label}`).digest();
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
async function backfill(env, operation, mode) {
  const args = [
    "--experimental-strip-types",
    "apps/api/src/cli/backfill-interview-cases.ts",
    "--op-id",
    operation,
    "--reason",
    "Production migration",
    "--legacy-drained",
    "--limit",
    "64",
    "--max-batches",
    "1000",
    ...(mode ? [mode] : []),
  ];
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 8192) stderr += chunk;
    });
    let output = "",
      failed = false,
      killTimer;
    const stop = () => {
      failed = true;
      child.kill("SIGTERM");
      killTimer ??= setTimeout(() => child.kill("SIGKILL"), 5000);
    };
    const timer = setTimeout(() => {
      stop();
    }, 300000);
    child.stdout.on("data", (chunk) => {
      if (!failed) output += chunk;
      if (output.length > 8192) {
        output = "";
        stop();
      }
    });
    child.once("error", () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      reject(new Error("Backfill unavailable"));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      try {
        const value = JSON.parse(output);
        if (failed || code !== 0 || value.complete !== true || value.dryRun !== false)
          throw new Error();
        resolve({ attempted: value.attempted, completed: value.completed });
      } catch {
        const error = new Error("Backfill incomplete");
        try {
          const record = stderr
            .split("\n")
            .filter((line) => line.startsWith('{"error":"backfill-failed"'))
            .map((line) => JSON.parse(line))[0];
          if (record) error.diagnostic = record;
        } catch {}
        reject(error);
      }
    });
  });
}
async function quiescent(client) {
  const result = await client.query(
    `SELECT NOT EXISTS (SELECT 1 FROM public.execution_jobs WHERE NOT finished) AS jobs, NOT EXISTS (SELECT 1 FROM pg_prepared_xacts WHERE database=current_database()) AS prepared`,
  );
  if (result.rows[0]?.jobs !== true || result.rows[0]?.prepared !== true)
    throw new Error("Legacy database is not quiescent");
}
export async function transitionProductionDatabase(options, dependencies = {}) {
  const {
    databaseURL,
    authOrigin,
    productionRunId,
    runtimeRole,
    runtimePassword,
    assertLegacyStopped,
  } = options;
  const report = (step, owner) => options.report?.({ step, ...(owner ? { owner } : {}) });
  report("validate-configuration");
  const identity = operatorDatabaseIdentity(databaseURL);
  const url = new URL(databaseURL),
    auth = new URL(authOrigin);
  if (
    url.pathname !== "/neondb" ||
    !url.username ||
    !url.password ||
    auth.origin !== authOrigin ||
    auth.protocol !== "https:" ||
    !/^[0-9]{1,20}$/.test(productionRunId ?? "") ||
    !/^quorem_hono_runtime_[a-f0-9]{12,32}$/.test(runtimeRole ?? "") ||
    decodeURIComponent(url.username) === runtimeRole ||
    typeof runtimePassword !== "string" ||
    !/^[\x21-\x7e]{32,}$/.test(runtimePassword) ||
    decodeURIComponent(url.password) === runtimePassword ||
    typeof assertLegacyStopped !== "function" ||
    typeof dependencies.backfillProblemVersions !== "function"
  )
    throw new Error("Invalid production transition configuration");
  const seed =
    options.operationId ??
    op(JSON.stringify([identity, productionRunId, runtimeRole]), "transition");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(seed))
    throw new Error("Invalid transition operation");
  const runtimeURL = new URL(url);
  runtimeURL.username = runtimeRole;
  runtimeURL.password = runtimePassword;
  const control = new Client({
    connectionString: url.href,
    connectionTimeoutMillis: 5000,
    query_timeout: 15000,
  });
  let pool;
  try {
    report("connect");
    await control.connect();
    const locked = await control.query(
      "SELECT pg_try_advisory_lock(hashtextextended('quorem-production-transition-v1',0)) AS ok",
    );
    if (locked.rows[0]?.ok !== true) throw new Error("Production transition already running");
    await quiescent(control);
    if ((await assertLegacyStopped()) === false) throw new Error("Legacy shutdown unconfirmed");
    const peers = await control.query(
      "SELECT pg_terminate_backend(pid,5000) AS stopped FROM pg_stat_activity WHERE datname=current_database() AND usename=current_user AND backend_type='client backend' AND pid<>pg_backend_pid()",
    );
    if (peers.rows.some((row) => row.stopped !== true)) throw new Error("Legacy sessions remain");
    await quiescent(control);
    pool = new Pool({
      connectionString: url.href,
      max: 2,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 5000,
    });
    pool.on("error", () => {});
    report("verify-operator");
    const operator = await verifiedOperator(drizzle(pool), authOrigin);
    for (const owner of ["product", "auth"]) {
      if ((await assertLegacyStopped()) === false) throw new Error("Legacy shutdown unconfirmed");
      const schema = owner === "product" ? "public" : "quorem_auth";
      const column = await control.query(
        "SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name='schema_migrations' AND column_name='checksum') AS present",
        [schema],
      );
      const legacy =
        !column.rows[0].present ||
        (
          await control.query(
            `SELECT EXISTS(SELECT 1 FROM ${schema}.schema_migrations WHERE checksum IS NULL) AS pending`,
          )
        ).rows[0].pending;
      if (legacy) {
        report("baseline", owner);
        await runMigrationBaseline(
          {
            pool,
            owner,
            runId: productionRunId,
            operator,
            issuer: authOrigin,
            operationId: op(seed, `baseline-${owner}`),
            reason: "Production migration",
            apply: true,
          },
          {
            fence: async (client) => {
              await quiescent(client);
            },
            ...(dependencies.request ? { request: dependencies.request } : {}),
          },
        );
      }
      report("migrate", owner);
      await migrate(pool, owner, `${root}apps/${owner === "product" ? "api" : "auth"}/migrations`);
    }
    report("backfill");
    const env = { ...process.env, QUOREM_OPERATOR_DATABASE_URL: url.href, AUTH_ORIGIN: authOrigin };
    const batches = {};
    for (const [name, mode] of [
      ["inputs", undefined],
      ["privateResults", "--private-results"],
      ["results", "--results"],
    ]) {
      if ((await assertLegacyStopped()) === false) throw new Error("Legacy shutdown unconfirmed");
      await quiescent(control);
      report("backfill", name);
      batches[name] = await (dependencies.backfill ?? backfill)(env, op(seed, name), mode);
      if (
        !batches[name] ||
        !Number.isSafeInteger(batches[name].attempted) ||
        !Number.isSafeInteger(batches[name].completed) ||
        batches[name].attempted < 0 ||
        batches[name].completed < 0 ||
        batches[name].completed > batches[name].attempted
      )
        throw new Error("Backfill evidence unavailable");
    }
    if ((await assertLegacyStopped()) === false) throw new Error("Legacy shutdown unconfirmed");
    await quiescent(control);
    report("backfill-versions");
    const versions = await dependencies.backfillProblemVersions({
      pool,
      databaseURL: url.href,
      operator,
      issuer: authOrigin,
      operationId: op(seed, "problem-versions"),
    });
    if (
      versions?.complete !== true ||
      versions?.dryRun !== false ||
      !Number.isSafeInteger(versions.completed) ||
      versions.completed < 0
    )
      throw new Error("Problem version backfill incomplete");
    await quiescent(control);
    await control.query("BEGIN");
    try {
      await control.query("SET LOCAL lock_timeout='5s'");
      await control.query("SET LOCAL statement_timeout='15s'");
      if ((await verifiedOperator(drizzle(control), authOrigin)) !== operator)
        throw new Error("Operator changed");
      const roleOperation = `production-role:${op(seed, "role")}`;
      const prior = await control.query(
        "SELECT actor,user_id,action,scope,reason FROM public.access_audit WHERE operation_id=$1 FOR UPDATE",
        [roleOperation],
      );
      if (
        prior.rows.length &&
        (prior.rows[0].actor !== operator ||
          prior.rows[0].user_id !== operator ||
          prior.rows[0].reason !== "Production migration" ||
          prior.rows[0].action !== "runtime.provision" ||
          prior.rows[0].scope !== runtimeRole)
      )
        throw new Error("Runtime role operation conflict");
      report("runtime-role");
      await configureRestrictedRole(control, runtimeRole, runtimePassword, (step) => report(step), {
        databaseName: "neondb",
        isolateConnections: false,
        existing: prior.rows.length === 1,
      });
      if (!prior.rows.length)
        await control.query(
          "INSERT INTO public.access_audit(operation_id,actor,user_id,action,scope,reason) VALUES($1,$2,$2,'runtime.provision',$3,'Production migration')",
          [roleOperation, operator, runtimeRole],
        );
      await control.query("COMMIT");
    } catch (error) {
      await control.query("ROLLBACK").catch(() => {});
      throw error;
    }
    const runtime = new Client({
      connectionString: runtimeURL.href,
      connectionTimeoutMillis: 5000,
      query_timeout: 10000,
    });
    try {
      await runtime.connect();
      const row = (
        await runtime.query("SELECT current_user AS role,current_database() AS database")
      ).rows[0];
      if (row.role !== runtimeRole || row.database !== "neondb")
        throw new Error("Runtime login unconfirmed");
    } finally {
      await runtime.end().catch(() => {});
    }
    return {
      runtimeURL: runtimeURL.href,
      operationId: seed,
      operator,
      batches,
      versions: { completed: versions.completed, complete: true },
    };
  } finally {
    await pool?.end().catch(() => {});
    await control.end().catch(() => {});
  }
}
