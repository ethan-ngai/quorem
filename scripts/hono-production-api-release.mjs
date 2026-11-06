/** @file hono-production-api-release.mjs @description Apply additive migrations and roll the active API Worker. @module deployment */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createRequire } from "node:module";
import {
  judgingScopeIdle,
  judgingPeerSecret,
  judgingScopeCompatible,
} from "./hono-judging-release.mjs";
import { configureRestrictedRole } from "./hono-stage-database-role.mjs";
import { JUDGING_DEFAULTS } from "../packages/execution/src/scheduling.ts";
import { putWorkerSecrets } from "./hono-stage-deploy-secrets.mjs";
import { workerConfig } from "./hono-stage-config.mjs";
import { runStageCommand } from "./hono-stage-command.mjs";
import { terraformBackendArgs } from "./hono-terraform-backend.mjs";
import { configureProductionHyperdrive } from "./hono-production-capacity.mjs";

const { Client } = createRequire(new URL("../packages/database/package.json", import.meta.url))(
  "pg",
);
const worker = "quorem-hono-production";
const origin = "https://quorem.app";
function outputs(env, directory, key) {
  runStageCommand("terraform", terraformBackendArgs(env, directory, key), env);
  return JSON.parse(
    runStageCommand("terraform", [`-chdir=infra/terraform/${directory}`, "output", "-json"], env),
  );
}
async function bindings(env) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${worker}/settings`,
    {
      headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) throw new Error(`Worker settings HTTP ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload.result?.bindings)) throw new Error("Worker bindings unavailable");
  return payload.result.bindings;
}
const bindingSet = (rows) =>
  rows
    .map(({ name, type }) => `${name}:${type}`)
    .sort()
    .join("\n");

async function verify() {
  for (let i = 0; i < 12; i++) {
    const [health, auth, authoring] = await Promise.all(
      [
        fetch(`${origin}/health`, { signal: AbortSignal.timeout(10000) }),
        fetch(`${origin}/api/auth/quorem-config`, { signal: AbortSignal.timeout(10000) }),
        fetch(`${origin}/v1/admin/question-drafts/import?preview=1`, {
          method: "POST",
          body: "{}",
          signal: AbortSignal.timeout(10000),
        }),
      ].map(async (request) => {
        const response = await request.catch(() => undefined);
        await response?.body?.cancel();
        return response?.status;
      }),
    );
    if (health === 200 && auth === 200 && authoring === 401) return;
    await delay(5000);
  }
  throw new Error("Production health, auth, or import route did not verify");
}

async function release(env) {
  if (
    env.GITHUB_REF !== "refs/heads/main" ||
    env.GITHUB_SHA !== env.HONO_RELEASE_SHA ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "")
  )
    throw new Error("Exact main release required");
  runStageCommand("bash", ["scripts/require-main.sh"], env);
  const bootstrap = outputs(env, "hono-production", "hono-production");
  if (bootstrap.activation?.value?.phase !== "active")
    throw new Error("Native production is inactive");
  const database = new URL(bootstrap.secrets.value.DATABASE_URL);
  if (database.pathname !== "/neondb" || !database.hostname.endsWith(".neon.tech"))
    throw new Error("Unexpected production database");

  const before = await bindings(env);
  const vars = Object.fromEntries(
    before
      .filter(
        (binding) => binding.type === "plain_text" && binding.name !== "EXECUTION_WAKE_PROVIDER",
      )
      .map(({ name, text }) => [name, text]),
  );
  if (vars.APP_ENV !== "production") throw new Error("Worker is not configured for production");
  // Coordinated topology releases adopt the tested case-lane policy.
  if (env.HONO_JUDGING_SCOPE_UPDATE === "true" && vars.JUDGING_CASE_LANES !== undefined)
    vars.JUDGING_CASE_LANES = String(JUDGING_DEFAULTS.caseLanes);
  const api = outputs(env, "hono-stage", "hono-production-api");
  const services = outputs(env, "hono-services", "hono-production-services");
  const temporary = await mkdtemp(join(tmpdir(), "quorem-api-release-"));
  try {
    const configFile = join(temporary, "wrangler.json");
    const config = workerConfig(
      { stageZone: "quorem.app", vars },
      { ...api, services },
      configFile,
      "production",
    );
    const expected = [
      ...Object.keys(config.vars).map((name) => ({ name, type: "plain_text" })),
      ...config.hyperdrive.map(({ binding: name }) => ({ name, type: "hyperdrive" })),
      ...config.queues.producers.map(({ binding: name }) => ({ name, type: "queue" })),
      ...config.durable_objects.bindings.map(({ name }) => ({
        name,
        type: "durable_object_namespace",
      })),
      ...(config.r2_buckets ?? []).map(({ binding: name }) => ({ name, type: "r2_bucket" })),
    ];
    const judgingServices = [...config.services];
    // Permit the controlled removal of a premature binding during a staged rollout.
    if (!judgingServices.some(({ binding }) => binding === "RESULT_VERIFIER"))
      judgingServices.push({
        binding: "RESULT_VERIFIER",
        service: "quorem-hono-services-production-verifier",
      });
    const judgingNames = new Set(judgingServices.map(({ binding }) => binding));
    for (const { binding, service } of judgingServices) {
      const existing = before.find(({ name }) => name === binding);
      if (existing && (existing.type !== "service" || existing.service !== service))
        throw new Error("Unexpected judging service binding");
    }
    if (
      bindingSet(expected) !==
      bindingSet(
        before.filter(
          ({ name, type }) =>
            !judgingNames.has(name) && type !== "secret_text" && type !== "secret_key",
        ),
      )
    )
      throw new Error("Active Worker bindings differ from the deployment configuration");
    await writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
    console.log(JSON.stringify({ phase: "migrate-active-api" }));
    runStageCommand(
      "vp",
      ["exec", "node", "packages/database/src/migrate.ts", "product", "apps/api/migrations"],
      {
        ...env,
        DATABASE_URL: database.href,
      },
    );
    const keys = bootstrap.secrets.value;
    if (!/^quorem_hono_runtime_[a-f0-9]{12,32}$/.test(keys.RUNTIME_ROLE ?? ""))
      throw new Error("Invalid active runtime role");
    database.search = "?sslmode=verify-full";
    const operator = new Client({
      connectionString: database.href,
      connectionTimeoutMillis: 10000,
      query_timeout: 10000,
    });
    let maxConnections;
    try {
      await operator.connect();
      maxConnections = (
        await operator.query("SELECT current_setting('max_connections')::int AS maximum")
      ).rows[0].maximum;
      await operator.query("BEGIN");
      await configureRestrictedRole(operator, keys.RUNTIME_ROLE, keys.RUNTIME_PASSWORD, () => {}, {
        databaseName: "neondb",
        isolateConnections: false,
        existing: true,
      });
      if (env.HONO_JUDGING_SCOPE_UPDATE === "true") {
        const scope = JSON.parse(judgingPeerSecret(keys, services.origins.value, env.GITHUB_SHA))[0]
          .scope;
        const compatible =
          env.HONO_PRESERVE_JUDGING_SCOPE === "true"
            ? await judgingScopeCompatible(operator, scope)
            : await judgingScopeIdle(operator);
        if (!compatible) throw new Error("Prior judging scope is not drained or compatible");
      }
      await operator.query("COMMIT");
    } catch (error) {
      await operator.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      await operator.end().catch(() => {});
    }
    await configureProductionHyperdrive(env, {
      id: api.hyperdrive_id.value,
      role: keys.RUNTIME_ROLE,
      password: keys.RUNTIME_PASSWORD,
      maxConnections,
    });
    if (env.HONO_JUDGING_SCOPE_UPDATE === "true") {
      putWorkerSecrets(
        worker,
        { RUNNER_PEERS: judgingPeerSecret(keys, services.origins.value, env.GITHUB_SHA) },
        env,
      );
    }

    runStageCommand("bash", ["scripts/require-main.sh"], env);
    console.log(JSON.stringify({ phase: "deploy-active-api" }));
    runStageCommand(
      "vp",
      ["-C", "apps/api", "exec", "wrangler", "deploy", "--config", configFile, "--keep-vars"],
      env,
    );
    const after = await bindings(env);
    const expectedBindings = [
      ...before.filter(({ name }) => !judgingNames.has(name)),
      ...judgingServices.map(({ binding: name }) => ({ name, type: "service" })),
    ];
    if (
      bindingSet(after) !== bindingSet(expectedBindings) ||
      judgingServices.some(
        ({ binding, service }) => after.find(({ name }) => name === binding)?.service !== service,
      )
    )
      throw new Error("Deployed Worker bindings differ from the previous version");
    await verify();
    console.log(JSON.stringify({ phase: "active-api-verified", release: env.GITHUB_SHA }));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

try {
  await release(process.env);
} catch (error) {
  console.error(
    JSON.stringify({
      error: "active-api-release-failed",
      reason: error instanceof Error ? error.message : "unknown",
    }),
  );
  process.exitCode = 1;
}
