/** Destructive reset of an unused isolated stage; never touches production state. */
import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { requirePrivateStageState } from "./hono-stage-state.mjs";
import { bootstrapEnvironment } from "./hono-stage-launch.mjs";
import { assembleStageConfig, createStageSecrets } from "./hono-stage-bootstrap-config.mjs";
import { terraformInitArgs } from "./hono-stage-deploy.mjs";
import { runStageCommand, StageCommandFailure } from "./hono-stage-command.mjs";
import { stageDatabaseURL } from "./hono-stage-deploy-database.mjs";
import {
  assertStageRuntimeFenced,
  stageFenceOptions,
  stageRecoveryLockKey,
} from "./hono-stage-recovery-fence.mjs";
import { deriveStageRole } from "./hono-stage-database-role.mjs";
import { verifyCompleteHistory } from "../packages/database/src/migrations.ts";
import * as schema from "../packages/database/src/schema/index.ts";
const require = createRequire(new URL("../packages/database/package.json", import.meta.url));
const { Client } = require("pg");
const { is } = require("drizzle-orm");
const { PgTable, isPgView, getTableConfig, getViewConfig } = require("drizzle-orm/pg-core");
const quote = (v) => `"${v.replaceAll('"', '""')}"`;
const expected = Object.entries(schema).flatMap(([name, definitions]) =>
  Object.values(definitions).flatMap((value) => {
    const namespace = name === "product" ? "public" : "quorem_auth";
    if (is(value, PgTable)) return [{ namespace, name: getTableConfig(value).name, kind: "r" }];
    if (isPgView(value)) return [{ namespace, name: getViewConfig(value).name, kind: "v" }];
    return [];
  }),
);
const key = (r) => `${r.namespace}.${r.name}:${r.kind}`;

// Every allowed row is owned by a synthetic actor or a known published fixture.
async function fixtureTables(client) {
  const dir = fileURLToPath(new URL("../fixtures/problems/", import.meta.url));
  const items = await Promise.all(
    (await readdir(dir))
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map(async (name) => JSON.parse(await readFile(join(dir, name), "utf8")).problem),
  );
  const pairs = items.map((p) => ({ slug: p.slug, id: p.id, version: Number(p.version) }));
  if (
    !pairs.length ||
    pairs.some(
      (p) =>
        typeof p.slug !== "string" ||
        !/^[a-f0-9-]{36}$/.test(p.id) ||
        !Number.isSafeInteger(p.version),
    )
  )
    throw new Error("Invalid fixture catalog");
  const valid = (
    await client.query(
      `WITH expected AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(slug text,id uuid,version integer))
    SELECT NOT EXISTS (SELECT 1 FROM problems p LEFT JOIN expected e ON e.slug=p.slug LEFT JOIN problem_versions v ON v.problem_id=p.id AND v.id=e.id AND v.version=e.version WHERE e.id IS NULL OR p.owner_id IS NOT NULL OR p.current_version_id IS DISTINCT FROM e.id OR v.id IS NULL OR NOT v.sealed)
      AND NOT EXISTS (SELECT 1 FROM problem_versions v LEFT JOIN problems p ON p.id=v.problem_id LEFT JOIN expected e ON e.slug=p.slug AND e.id=v.id AND e.version=v.version WHERE e.id IS NULL)
      AND NOT EXISTS (SELECT 1 FROM quorem_auth."user" u WHERE u.id !~ '^stage-fixture-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' OR u.name<>u.id OR u.email<>u.id||'@example.test' OR NOT u."emailVerified")
      AND NOT EXISTS (SELECT 1 FROM identity_bindings b LEFT JOIN quorem_auth."user" u ON u.id=b.subject WHERE u.id IS NULL OR b.issuer<>'https://hono-stage.quorem.app')
      AND NOT EXISTS (SELECT 1 FROM users u LEFT JOIN identity_bindings b ON b.user_id=u.id WHERE b.user_id IS NULL OR u.role<>'user' OR u.kind<>'account')
      AND NOT EXISTS (SELECT 1 FROM quorem_auth."session" s LEFT JOIN quorem_auth."user" u ON u.id=s."userId" WHERE u.id IS NULL)
      AND NOT EXISTS (SELECT 1 FROM workspaces w LEFT JOIN users u ON u.id=w.owner_id LEFT JOIN problem_versions v ON v.id=w.problem_version_id WHERE u.id IS NULL OR v.id IS NULL OR w.kind<>'solo' OR w.match_id IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM submissions s LEFT JOIN workspaces w ON w.id=s.workspace_id WHERE w.id IS NULL OR w.owner_id<>s.owner_id OR s.match_id IS NOT NULL OR s.interview_id IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM deadline_prearms WHERE purpose<>'execution' OR shard<>0)
      AND (NOT EXISTS (SELECT 1 FROM quorem_auth.jwks) OR EXISTS (SELECT 1 FROM quorem_auth."user")) AS valid`,
      [JSON.stringify(pairs)],
    )
  ).rows[0]?.valid;
  if (!valid) throw new Error("Unexpected non-fixture data");
  const checks = new Map();
  for (const name of [
    "problem_examples",
    "problem_languages",
    "problem_odyssey_cases",
    "problem_solutions",
    "problem_tags",
    "problem_test_cases",
    "runner_version_input_cases",
    "runner_version_inputs",
  ])
    checks.set(
      `public.${name}`,
      `NOT EXISTS (SELECT 1 FROM public.${quote(name)} x LEFT JOIN problem_versions v ON v.id=x.version_id WHERE v.id IS NULL)`,
    );
  for (const name of [
    "execution_jobs",
    "execution_attempt_usage",
    "execution_idempotency",
    "cancellation_idempotency",
    "submission_outbox",
    "submission_public_case_statuses",
    "submission_public_result_cases",
    "submission_result_header_fields",
    "submission_result_headers",
  ])
    checks.set(
      `public.${name}`,
      `NOT EXISTS (SELECT 1 FROM public.${quote(name)} x LEFT JOIN submissions s ON s.id=x.submission_id WHERE s.id IS NULL)`,
    );
  for (const name of [
    "execution_attempt_inventory",
    "execution_checkpoint_cases",
    "execution_checkpoints",
    "execution_completion_field_chunks",
    "execution_completion_frames",
    "execution_completion_header_fields",
    "execution_completion_receipts",
    "execution_completion_staging",
    "execution_dispatch_intents",
    "execution_verification_challenges",
    "execution_verified_cases",
    "runner_job_input_cases",
    "runner_job_inputs",
  ])
    checks.set(
      `public.${name}`,
      `NOT EXISTS (SELECT 1 FROM public.${quote(name)} x LEFT JOIN execution_jobs j ON j.id=x.job_id WHERE j.id IS NULL)`,
    );
  for (const name of ["execution_idempotency", "cancellation_idempotency"])
    checks.set(
      `public.${name}`,
      `NOT EXISTS (SELECT 1 FROM public.${quote(name)} x LEFT JOIN submissions s ON s.id=x.submission_id WHERE s.id IS NULL OR x.owner_id<>s.owner_id)`,
    );
  checks.set(
    "public.runner_job_inputs",
    `NOT EXISTS (SELECT 1 FROM runner_job_inputs x LEFT JOIN execution_jobs j ON j.id=x.job_id LEFT JOIN submissions s ON s.id=j.submission_id LEFT JOIN workspaces w ON w.id=s.workspace_id WHERE w.id IS NULL OR x.version_id IS DISTINCT FROM w.problem_version_id OR x.session_id IS NOT NULL)`,
  );
  checks.set(
    "public.execution_verification_output_chunks",
    `NOT EXISTS (SELECT 1 FROM public.execution_verification_output_chunks x LEFT JOIN execution_verification_challenges c ON c.id=x.challenge_id WHERE c.id IS NULL)`,
  );
  checks.set(
    "public.runner_input_blobs",
    `NOT EXISTS (SELECT 1 FROM runner_input_blobs b WHERE NOT EXISTS (SELECT 1 FROM runner_version_inputs v WHERE b.hash IN (v.metadata_hash,v.fixture_hash)) AND NOT EXISTS (SELECT 1 FROM runner_version_input_cases c WHERE c.blob_hash=b.hash) AND NOT EXISTS (SELECT 1 FROM runner_job_inputs j WHERE b.hash=j.metadata_hash) AND NOT EXISTS (SELECT 1 FROM runner_job_input_cases c WHERE c.blob_hash=b.hash))`,
  );
  for (const name of [
    "problems",
    "problem_versions",
    "users",
    "identity_bindings",
    "workspaces",
    "submissions",
    "deadline_prearms",
  ])
    checks.set(`public.${name}`, "true");
  for (const name of ["user", "session", "jwks"]) checks.set(`quorem_auth.${name}`, "true");
  return checks;
}

/** Hold the recovery lock and table locks until the caller finishes destroying Workers. */
export async function lockEmptyStage(
  client,
  { role, databaseIdentity, namespace, fenceOptions = {}, allowFixtures = false },
) {
  if (
    !/^quorem_stage_runtime_[a-f0-9]{32}$/.test(role ?? "") ||
    typeof databaseIdentity !== "string" ||
    !databaseIdentity.endsWith(":quorem_hono_stage") ||
    !/^[a-f0-9]{64}$/.test(namespace ?? "") ||
    namespace === "0".repeat(64)
  )
    throw new Error("Invalid stage reset identity");
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL statement_timeout='10s'");
    await client.query("SET LOCAL lock_timeout='2s'");
    const lock = await client.query(
      "SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired",
      [stageRecoveryLockKey],
    );
    if (!lock.rows[0]?.acquired) throw new Error("Stage reset lock unavailable");
    await client.query("SELECT pg_advisory_xact_lock(740010)");
    await client.query("SELECT pg_advisory_xact_lock(714901,1)");
    await assertStageRuntimeFenced(client, role, fenceOptions);
    const namespaces = (
      await client.query(
        "SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema') AND nspname NOT LIKE 'pg\\_%' ESCAPE '\\' ORDER BY 1",
      )
    ).rows.map((r) => r.nspname);
    if (namespaces.join(",") !== "public,quorem_auth") throw new Error("Unexpected stage schema");
    const actual = (
      await client.query(
        `SELECT n.nspname AS namespace,c.relname AS name,c.relkind AS kind,pg_get_userbyid(c.relowner)=current_user AS owned FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','quorem_auth') AND c.relkind IN ('r','p','v','m','f')`,
      )
    ).rows;
    if (
      actual.some((r) => !r.owned) ||
      JSON.stringify(actual.map(key).sort()) !== JSON.stringify(expected.map(key).sort())
    )
      throw new Error("Unexpected stage catalog");
    for (const table of expected
      .filter((r) => r.kind === "r")
      .sort((a, b) => key(a).localeCompare(key(b))))
      await client.query(`LOCK TABLE ${quote(table.namespace)}.${quote(table.name)} IN SHARE MODE`);
    await verifyCompleteHistory(
      client,
      "product",
      fileURLToPath(new URL("../apps/api/migrations", import.meta.url)),
    );
    await verifyCompleteHistory(
      client,
      "auth",
      fileURLToPath(new URL("../apps/auth/migrations", import.meta.url)),
    );
    const fixtureChecks = allowFixtures ? await fixtureTables(client) : new Map();
    for (const table of expected.filter((r) => r.kind === "r" && r.name !== "schema_migrations")) {
      const target = `${quote(table.namespace)}.${quote(table.name)}`;
      let query = `SELECT NOT EXISTS(SELECT 1 FROM ${target} LIMIT 1) AS valid`,
        args = [];
      if (table.namespace === "public" && table.name === "runner_input_gc_state")
        query = `SELECT count(*)=1 AND bool_and(id=1 AND cursor IS NULL) AS valid FROM ${target}`;
      if (table.namespace === "public" && table.name === "stage_genesis") {
        query = `SELECT count(*)=1 AND bool_and(database_identity=$1 AND namespace=$2) AS valid FROM ${target}`;
        args = [databaseIdentity, namespace];
      }
      if (fixtureChecks.has(`${table.namespace}.${table.name}`))
        query = `SELECT ${fixtureChecks.get(`${table.namespace}.${table.name}`)} AS valid`;
      if (!(await client.query(query, args)).rows[0]?.valid)
        throw new Error("Stage contains data or mismatched genesis");
    }
    await assertStageRuntimeFenced(client, role, fenceOptions);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

const serviceAllowed =
  /^(?:cloudflare_worker\.services|terraform_data\.(?:case_namespace_pin\[0\]|case_images)|cloudflare_worker_version\.services|restapi_object\.(?:trusted\["(?:runner|verifier|image)"\]|trusted_rollout\["(?:runner|verifier|image)"\]|case)|cloudflare_workers_custom_domain\.service\["(?:runner|drain|verifier|case|image)"\])$/;
const stageAllowed =
  /^(?:cloudflare_worker\.api|cloudflare_hyperdrive_config\.database|cloudflare_queue_consumer\.execution\[0\])$/;
export function validateResetPlan(plan, allowed) {
  if (!Array.isArray(plan.resource_changes) || !Array.isArray(plan.resource_drift ?? []))
    throw new Error("Invalid reset plan");
  for (const change of [...plan.resource_changes, ...(plan.resource_drift ?? [])]) {
    const actions = change.change?.actions;
    if (
      !Array.isArray(actions) ||
      (actions.join(",") !== "no-op" &&
        (!allowed.test(change.address) || actions.join(",") !== "delete"))
    )
      throw new Error("Unexpected reset plan change");
  }
}
export async function resetStage(original, operations = {}) {
  if (
    original.GITHUB_REF !== "refs/heads/feat/hono-migration" ||
    original.GITHUB_SHA !== original.HONO_RELEASE_SHA ||
    !/^[a-f0-9]{40}$/.test(original.HONO_RELEASE_SHA ?? "") ||
    !/^[a-f0-9]{40}$/.test(original.HONO_RESET_TARGET_RELEASE ?? "")
  )
    throw new Error("Exact staged release required");
  if (
    original.HONO_STAGE_RESET_FIXTURES !== undefined &&
    !["true", "false"].includes(original.HONO_STAGE_RESET_FIXTURES)
  )
    throw new Error("Invalid fixture reset option");
  const run = operations.run ?? runStageCommand;
  await requirePrivateStageState(original);
  const bootstrap = bootstrapEnvironment(original, createStageSecrets());
  const envInput = {
    ...original,
    QUOREM_REMOTE_VALIDATION_DATABASE_URL:
      "postgres://fixture:fixture@127.0.0.1:54329/quorem_hono_remote_validation_test?sslmode=disable",
  };
  const dir = await mkdtemp(join(tmpdir(), "quorem-stage-reset-"));
  const overrides = [];
  let client;
  const execute = (stack, args, env) =>
    run("terraform", [`-chdir=infra/terraform/${stack}`, ...args], env);
  try {
    await chmod(dir, 0o700);
    run("terraform", terraformInitArgs(original, "hono-bootstrap"), bootstrap);
    const outputs = JSON.parse(execute("hono-bootstrap", ["output", "-json"], bootstrap));
    const env = assembleStageConfig(outputs, envInput);
    const dummyImage = `registry.cloudflare.com/${original.CLOUDFLARE_ACCOUNT_ID}/reset@sha256:${"0".repeat(64)}`;
    env.TF_VAR_runner_image = dummyImage;
    env.TF_VAR_verifier_image = dummyImage;
    env.TF_VAR_image_service_image = dummyImage;
    env.TF_VAR_case_images = JSON.stringify(
      Object.fromEntries(
        ["python", "java", "typescript", "ocaml", "postgresql"].map((k) => [k, dummyImage]),
      ),
    );
    env.TF_VAR_database_user = deriveStageRole(original.HONO_RESET_TARGET_RELEASE, "1");
    env.TF_VAR_release_sha = original.HONO_RESET_TARGET_RELEASE;
    env.TF_VAR_release_generation = "1";
    for (const stack of ["hono-services", "hono-stage"])
      run("terraform", terraformInitArgs(original, stack), env);
    const service = JSON.parse(execute("hono-services", ["output", "-json"], env));
    let namespace = service?.origins?.value?.QUOREM_CASE_NAMESPACE_ID;
    const role = env.TF_VAR_database_user;
    client = new Client({
      connectionString: stageDatabaseURL(env),
      connectionTimeoutMillis: 5000,
      query_timeout: 15000,
    });
    client.on("error", () => {});
    await client.connect();
    // The first reset may already have removed service outputs before a later failure.
    namespace ??= (await client.query("SELECT namespace FROM public.stage_genesis WHERE singleton"))
      .rows[0]?.namespace;
    env.TF_VAR_case_namespace_id = namespace;
    await lockEmptyStage(client, {
      role,
      databaseIdentity: env.HONO_STAGE_DATABASE_IDENTITY,
      namespace,
      fenceOptions: stageFenceOptions(env.HONO_STAGE_DATABASE_URL),
      allowFixtures: original.HONO_STAGE_RESET_FIXTURES === "true",
    });
    const destroy = async (stack, target, allow, override) => {
      const path = resolve(`infra/terraform/${stack}/reset_override.tf.json`);
      if (override) {
        await writeFile(path, JSON.stringify(override), { flag: "wx", mode: 0o600 });
        overrides.push(path);
      }
      const plan = join(dir, `${stack}.tfplan`);
      const child = {
        ...env,
        ...(stack === "hono-bootstrap" ? bootstrap : {}),
        TF_VAR_worker_name:
          stack === "hono-services" ? env.HONO_SERVICES_WORKER_NAME : env.TF_VAR_worker_name,
      };
      execute(
        stack,
        [
          "plan",
          "-destroy",
          "-input=false",
          "-lock-timeout=5m",
          ...target.map((t) => `-target=${t}`),
          `-out=${plan}`,
        ],
        child,
      );
      await chmod(plan, 0o600);
      validateResetPlan(JSON.parse(execute(stack, ["show", "-json", plan], child)), allow);
      process.stdout.write(`${JSON.stringify({ phase: "reset", stack })}\n`);
      execute(stack, ["apply", "-input=false", "-lock-timeout=5m", plan], child);
    };
    await destroy("hono-services", [], serviceAllowed, {
      resource: {
        terraform_data: { case_namespace_pin: { lifecycle: { prevent_destroy: false } } },
      },
    });
    await destroy(
      "hono-stage",
      ["cloudflare_worker.api", "cloudflare_hyperdrive_config.database"],
      stageAllowed,
    );
    await assertStageRuntimeFenced(client, role, stageFenceOptions(env.HONO_STAGE_DATABASE_URL));
    await client.query("COMMIT");
    await client.end();
    client = undefined;
    await destroy("hono-bootstrap", ["neon_database.stage"], /^neon_database\.stage$/, {
      resource: { neon_database: { stage: { lifecycle: { prevent_destroy: false } } } },
    });
    return {
      status: "reset",
      stage: "isolated",
      database: "deleted",
      services: "deleted",
      queues: "retained",
    };
  } finally {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
      await client.end().catch(() => {});
    }
    for (const path of overrides) await rm(path, { force: true });
    await rm(dir, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const receipt = await resetStage(process.env);
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ error: "stage-reset-incomplete", ...(error instanceof StageCommandFailure ? { category: error.category, diagnostics: error.diagnostics } : {}) })}\n`,
    );
    process.exitCode = 1;
  }
}
