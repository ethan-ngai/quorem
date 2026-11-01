/** Stage inspection and rollback rehearsal; emit fixed fields, never credentials/provider payloads. */
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageControls } from "./hono-stage-controls.mjs";
import { remoteSandbox } from "../apps/runner/src/sandbox/remote.ts";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveStageRole,
  rehearseStageRole,
  provisionStageDatabaseRole,
  StageRoleFailure,
} from "./hono-stage-database-role.mjs";
import { fenceStageRuntime, stageFenceOptions } from "./hono-stage-recovery-fence.mjs";
import { terraformInitArgs } from "./hono-stage-deploy.mjs";
import { runStageCommand, StageCommandFailure } from "./hono-stage-command.mjs";
import {
  requireInitializableStageDatabase,
  StageInitializationFailure,
} from "./hono-stage-initialization.mjs";

/** Read queue dependency changes without applying or exposing Terraform values. */
async function inspectQueuePlans(env, url, role, password) {
  const directory = await mkdtemp(join(tmpdir(), "quorem-queue-inspection-"));
  const child = {
    ...env,
    TF_IN_AUTOMATION: "true",
    TF_VAR_account_id: env.CLOUDFLARE_ACCOUNT_ID,
    TF_VAR_worker_name: "quorem-hono-stage",
    TF_VAR_stage_hostname: "hono-stage.quorem.app",
    TF_VAR_database_host: url.hostname,
    TF_VAR_database_port: url.port || "5432",
    TF_VAR_database_name: "quorem_hono_stage",
    TF_VAR_database_user: role,
    TF_VAR_database_password: password,
    TF_VAR_database_connection_limit: "5",
    TF_VAR_profile_media_enabled: "false",
  };
  try {
    runStageCommand("terraform", terraformInitArgs(env, "hono-stage"), child);
    const plans = [];
    for (const enabled of [true, false]) {
      const file = join(directory, `${enabled}.tfplan`);
      const selected = { ...child, TF_VAR_enable_queue_consumer: String(enabled) };
      runStageCommand(
        "terraform",
        [
          "-chdir=infra/terraform/hono-stage",
          "plan",
          "-input=false",
          "-no-color",
          "-lock-timeout=30s",
          "-target=cloudflare_queue_consumer.execution",
          `-out=${file}`,
        ],
        selected,
      );
      await chmod(file, 0o600);
      const plan = JSON.parse(
        runStageCommand(
          "terraform",
          ["-chdir=infra/terraform/hono-stage", "show", "-json", file],
          selected,
        ),
      );
      const project = (entry) => ({
        address: /^[a-zA-Z0-9_.[\]"-]{1,200}$/.test(entry.address ?? "")
          ? entry.address
          : "unknown",
        actions: entry.change.actions,
        fields: Object.keys({ ...entry.change.before, ...entry.change.after }).filter(
          (key) =>
            JSON.stringify(entry.change.before?.[key]) !==
            JSON.stringify(entry.change.after?.[key]),
        ),
      });
      plans.push({
        enabled,
        changes: (plan.resource_changes ?? []).map(project),
        drift: (plan.resource_drift ?? []).map(project),
      });
    }
    return plans;
  } catch (error) {
    return {
      unavailable: true,
      ...(error instanceof StageCommandFailure
        ? { category: error.category, resources: error.resources, diagnostics: error.diagnostics }
        : {}),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Signed inventory identifies attempts; phase output is observational only. */
export async function caseDiagnostics(controls, origin, secret, scope, send = fetch) {
  const output = [];
  let after = "";
  const safe = (v) => (typeof v === "string" && /^[a-z-]{1,40}$/.test(v) ? v : "unknown");
  for (let pageNumber = 0; pageNumber < 16; pageNumber++) {
    const page = await controls.inventoryPage(after);
    if (page.after !== after || !Array.isArray(page.attempts) || page.attempts.length > 4)
      throw new Error("Invalid signed inventory");
    for (const attempt of page.attempts) {
      if (typeof attempt !== "string" || !/^[A-Za-z0-9-]{1,128}$/.test(attempt) || attempt <= after)
        throw new Error("Invalid signed inventory");
      after = attempt;
      const response = await send(`${origin}/internal/case/${attempt}`, {
        headers: {
          authorization: `Bearer ${secret}`,
          "x-quorem-owner-nonce": randomUUID(),
          "x-quorem-owner-scope": scope,
          "x-quorem-case-probe": "diagnostics",
        },
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      let data = {};
      if (response.status === 200 && response.body) {
        const reader = response.body.getReader();
        let size = 0;
        const chunks = [];
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.length;
            if (size > 1024) throw new Error("Oversized case diagnostic");
            chunks.push(part.value);
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        try {
          data = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
          );
        } catch {
          data = {};
        }
      } else await response.body?.cancel();
      output.push({
        index: output.length,
        status: response.status,
        phase: safe(data.phase),
        failure: safe(data.failure),
        source: safe(data.source),
      });
    }
    if (page.next === null) return { attempts: output, complete: true };
    if (!page.attempts.length || page.next !== after)
      throw new Error("Invalid signed inventory cursor");
  }
  return { attempts: output, complete: false };
}

async function inspectCases(env, saved) {
  const secrets = saved.stage_secrets?.value;
  if (!secrets) throw new Error("Stage secrets unavailable");
  runStageCommand("terraform", terraformInitArgs(env, "hono-services"), env);
  const data = JSON.parse(
    runStageCommand("terraform", ["-chdir=infra/terraform/hono-services", "output", "-json"], env),
  ).origins?.value;
  const origin = data?.CASE_ORIGIN,
    runnerOrigin = data?.DRAIN_ORIGIN,
    namespace = data?.QUOREM_CASE_NAMESPACE_ID;
  if (
    origin !== "https://case-hono-stage.quorem.app" ||
    runnerOrigin !== "https://runner-hono-stage.quorem.app" ||
    data.CASE_DIAGNOSTICS !== "true"
  )
    throw new Error("Stage case diagnostics unavailable");
  const sandbox = remoteSandbox({
    origin,
    namespaceId: namespace,
    secret: secrets.QUOREM_CASE_SECRET,
    ownerPublicKey: secrets.QUOREM_CASE_OWNER_PUBLIC_KEY_PEM,
    cleanupMs: 30000,
  });
  const dir = await mkdtemp(join(tmpdir(), "quorem-case-diagnostics-"));
  try {
    const key = join(dir, "public.pem");
    await writeFile(key, secrets.QUOREM_CASE_OWNER_PUBLIC_KEY_PEM, { mode: 0o600 });
    const controls = await stageControls({
      namespace,
      scope: sandbox.scope,
      release: data.SERVICES_RELEASE,
      bindings: data.SERVICES_BINDINGS,
      secret: secrets.RECOVERY_CONTROL_SECRET,
      caseOrigin: origin,
      runnerOrigin,
      publicKeyFile: key,
    });
    return await caseDiagnostics(controls, origin, secrets.QUOREM_CASE_SECRET, sandbox.scope);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

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
      (SELECT count(*)::int FROM public.users) AS users,
      (SELECT count(*)::int FROM public.workspaces) AS workspaces,
      (SELECT count(*)::int FROM public.submissions) AS submissions,
      (SELECT count(*)::int FROM public.submissions WHERE state='completed') AS completed_submissions,
      (SELECT count(*)::int FROM public.submissions WHERE result->>'verdict'='accepted') AS accepted_submissions,
      (SELECT count(*)::int FROM public.execution_jobs WHERE NOT finished) AS unfinished_jobs,
      (SELECT COALESCE(sum(attempts),0)::int FROM public.execution_jobs) AS claimed_attempts,
      (SELECT count(*)::int FROM public.execution_verification_challenges) AS verification_challenges,
      (SELECT count(*)::int FROM public.execution_verified_cases) AS verified_cases,
      (SELECT count(*)::int FROM public.execution_completion_staging) AS completion_streams,
      (SELECT count(*)::int FROM public.execution_completion_staging WHERE eof) AS eof_streams,
      (SELECT count(*)::int FROM public.execution_completion_receipts) AS completion_receipts,
      (SELECT COALESCE(sum(case_count+CASE WHEN submit_cases_are_samples THEN 0 ELSE sample_count END),0)::int FROM public.runner_job_inputs) AS expected_cases,
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
        "users",
        "workspaces",
        "submissions",
        "completed_submissions",
        "accepted_submissions",
        "unfinished_jobs",
        "claimed_attempts",
        "verification_challenges",
        "verified_cases",
        "completion_streams",
        "eof_streams",
        "completion_receipts",
        "expected_cases",
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
  if (!["diagnose", "rehearse-role", "probe-role", "fence-role", "reset-api"].includes(action))
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
    let provider;
    if (env.CLOUDFLARE_API_TOKEN && action === "diagnose") {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/containers/applications`,
        {
          headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
          signal: AbortSignal.timeout(15000),
        },
      );
      const result = await response.json();
      provider = {
        status: response.status,
        errors: (result.errors ?? []).map((item) => item.code),
        applications: Array.isArray(result.result)
          ? await Promise.all(
              result.result
                .filter((item) => item.name?.startsWith("quorem-hono-services-stage-"))
                .map(async (item) => {
                  const detail = await fetch(
                    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/containers/applications/${item.id}`,
                    {
                      headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
                      signal: AbortSignal.timeout(15000),
                    },
                  );
                  const body = await detail.json();
                  const instancesResponse = await fetch(
                    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/containers/applications/${item.id}/instances`,
                    {
                      headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
                      signal: AbortSignal.timeout(15000),
                    },
                  );
                  const instanceBody = await instancesResponse.json();
                  const instances = Array.isArray(instanceBody.result)
                    ? instanceBody.result
                    : (instanceBody.result?.instances ?? []);
                  return {
                    name: item.name,
                    scheduling: item.scheduling_policy,
                    status: detail.status,
                    instancesStatus: instancesResponse.status,
                    instances: instances.slice(0, 8).map((instance) => ({
                      state: /^[a-z_]{1,30}$/.test(instance.status?.state ?? "")
                        ? instance.status.state
                        : "unknown",
                      exitCode: Number.isInteger(instance.status?.exit_code)
                        ? instance.status.exit_code
                        : null,
                    })),
                    errors: (body.result?.errors ?? []).slice(0, 8).map((entry) => ({
                      name: /^[A-Za-z]{1,40}$/.test(entry.event?.name ?? "")
                        ? entry.event.name
                        : "unknown",
                      reason: new StageRoleFailure("unknown", { message: entry.event?.message })
                        .reason,
                    })),
                  };
                }),
            )
          : [],
      };
    }
    const before = await diagnoseStageRole(client, role);
    if (action === "fence-role") {
      let containment, failure;
      try {
        await fenceStageRuntime(client, role, stageFenceOptions(url.href));
        containment = "fenced";
      } catch (error) {
        containment = "unconfirmed";
        failure = new StageRoleFailure("unknown", error);
      }
      return {
        before,
        containment,
        ...(failure ? { failure } : {}),
        after: await diagnoseStageRole(client, role),
      };
    }
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
          reason: error.reason,
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
            await fenceStageRuntime(inspector, role, stageFenceOptions(url.href));
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
    if (action === "diagnose" || action === "reset-api") {
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
      if (action === "reset-api") {
        if (initialization.kind !== "migrated-empty")
          throw new Error("Stage initialization is not empty");
        const child = {
          ...env,
          TF_IN_AUTOMATION: "true",
          TF_VAR_account_id: env.CLOUDFLARE_ACCOUNT_ID,
          TF_VAR_worker_name: "quorem-hono-stage",
          TF_VAR_stage_hostname: "hono-stage.quorem.app",
          TF_VAR_database_host: url.hostname,
          TF_VAR_database_port: url.port || "5432",
          TF_VAR_database_name: "quorem_hono_stage",
          TF_VAR_database_user: role,
          TF_VAR_database_password: password,
          TF_VAR_database_connection_limit: "5",
          TF_VAR_profile_media_enabled: "true",
          TF_VAR_enable_queue_consumer: "false",
        };
        runStageCommand("terraform", terraformInitArgs(env, "hono-services"), child);
        let services = "";
        try {
          services = runStageCommand(
            "terraform",
            ["-chdir=infra/terraform/hono-services", "state", "list"],
            child,
          );
        } catch (error) {
          if (!(error instanceof StageCommandFailure) || !error.noState) throw error;
        }
        if (services.trim()) throw new Error("Private stage services already provisioned");
        runStageCommand("terraform", terraformInitArgs(env, "hono-stage"), child);
        // Remove only the failed API shell; retain the database, bucket and queue state.
        runStageCommand(
          "terraform",
          [
            "-chdir=infra/terraform/hono-stage",
            "destroy",
            "-target=cloudflare_worker.api",
            "-auto-approve",
            "-input=false",
            "-no-color",
            "-lock-timeout=5m",
          ],
          child,
        );
        return { ...before, initialization, apiShell: "removed" };
      }
      let cases;
      try {
        cases = await inspectCases(env, saved);
      } catch {
        cases = { unavailable: true };
      }
      return {
        ...before,
        initialization,
        ...(provider ? { provider } : {}),
        cases,
        queuePlans: await inspectQueuePlans(env, url, role, password),
      };
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
