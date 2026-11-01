/** @file hono-production-deploy.mjs @description Snapshot, fence and activate the native production backend. @module deployment */
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { productionState } from "./hono-production-state.mjs";
import { terraformBackendArgs } from "./hono-terraform-backend.mjs";
import { productionTerraform } from "./hono-production-terraform.mjs";
import { runStageCommand, StageCommandFailure } from "./hono-stage-command.mjs";
import { createStageSecrets } from "./hono-stage-bootstrap-config.mjs";
import { productionImages } from "./hono-production-images.mjs";
import { workerConfig } from "./hono-stage-config.mjs";
import { putWorkerSecrets } from "./hono-stage-deploy-secrets.mjs";
import { checkWorkerAuth } from "./hono-stage-preflight.mjs";
import { stageNamespace } from "./hono-stage-deploy-proof.mjs";
import { stageControls } from "./hono-stage-controls.mjs";
import { transitionProductionDatabase } from "./hono-production-database.mjs";
import { workerDiagnostic } from "./hono-worker-diagnostic.mjs";
const { Client } = createRequire(new URL("../packages/database/package.json", import.meta.url))(
  "pg",
);
const hex = () => randomBytes(32).toString("hex");
const hosts = {
  api: "api-hono.quorem.app",
  drain: "runner-hono.quorem.app",
  verifier: "verifier-hono.quorem.app",
  case: "case-hono.quorem.app",
  image: "image-hono.quorem.app",
  mail: "mail-hono.quorem.app",
};
let phase = "configuration";
const progress = (value) => {
  phase = value;
  console.log(JSON.stringify({ phase }));
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function databaseRead(url, sql) {
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 10000,
    query_timeout: 15000,
  });
  await client.connect();
  try {
    return (await client.query(sql)).rows;
  } finally {
    await client.end();
  }
}
async function cloudflare(env, path) {
  return fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}${path}`,
    {
      headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    },
  );
}
async function waitHTTP(url, expected, headers = {}) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      const ok = response.status === expected;
      await response.body?.cancel();
      if (ok) return;
    } catch {}
    await pause(2000);
  }
  throw new Error("Deployment endpoint unavailable");
}
const tf = (env, name, value) => {
  env[`TF_VAR_${name}`] = typeof value === "string" ? value : JSON.stringify(value);
};
async function operatorInputs(context) {
  const env = Object.fromEntries(
    ["PATH", "HOME", "USER", "TMPDIR", "CI"]
      .filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key]]),
  );
  Object.assign(env, {
    QUOREM_OPERATOR_DATABASE_URL: context.databaseURL,
    AUTH_ORIGIN: context.issuer,
  });
  return JSON.parse(
    runStageCommand(
      process.execPath,
      [
        "apps/api/src/cli/backfill-problem-inputs.ts",
        "--op-id",
        context.operationId,
        "--reason",
        "Production migration",
        "--legacy-drained",
        "--limit",
        "64",
        "--max-batches",
        "1000",
      ],
      env,
    ),
  );
}

export async function deployProduction(env) {
  if (
    env.GITHUB_SHA !== env.HONO_RELEASE_SHA ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "") ||
    !["refs/heads/feat/hono-migration", "refs/heads/main"].includes(env.GITHUB_REF)
  )
    throw new Error("Exact authorized production revision required");
  const temporary = await mkdtemp(join(tmpdir(), "quorem-production-"));
  try {
    progress("read-production-state");
    const original = productionState(env),
      old = original.runtime;
    if (
      old.BETTER_AUTH_SECRET !== env.BETTER_AUTH_SECRET ||
      old.AUTH_INTERNAL_SECRET !== env.AUTH_INTERNAL_SECRET ||
      old.QUOREM_INVITE_KEY !== env.QUOREM_INVITE_KEY
    )
      throw new Error("Production key continuity mismatch");
    const pending = await databaseRead(
      original.databaseURL,
      "SELECT count(*)::int AS n FROM execution_jobs WHERE NOT finished",
    );
    if (pending[0].n !== 0) throw new Error("Production jobs must drain before cutover");
    const photos = await databaseRead(
      original.databaseURL,
      "SELECT count(*)::int AS n FROM quorem_auth.\"user\" WHERE image IS NOT NULL AND image<>''",
    );
    if (photos[0].n !== 0) throw new Error("Referenced production photos require object copy");
    const bootstrap = { ...env };
    tf(bootstrap, "project_id", env.NEON_PROJECT_ID);
    tf(bootstrap, "neon_api_key", env.NEON_API_KEY);
    tf(bootstrap, "release_sha", env.GITHUB_SHA);
    tf(bootstrap, "secrets", {});
    runStageCommand("terraform", terraformBackendArgs(env, "hono-production"), bootstrap);
    let saved;
    try {
      saved = JSON.parse(
        runStageCommand(
          "terraform",
          ["-chdir=infra/terraform/hono-production", "output", "-json"],
          bootstrap,
        ),
      );
    } catch (error) {
      if (!(error instanceof StageCommandFailure) || !error.noState) throw error;
    }
    if (saved?.activation?.value?.phase === "active")
      throw new Error("Production native activation already complete");
    let keys = saved?.secrets?.value;
    if (!keys) {
      keys = {
        ...createStageSecrets(),
        BETTER_AUTH_SECRET: old.BETTER_AUTH_SECRET,
        AUTH_INTERNAL_SECRET: old.AUTH_INTERNAL_SECRET,
        MATCH_INVITE_KEY: old.QUOREM_INVITE_KEY,
        MAIL_RELAY_TOKEN: hex(),
        AUTH_MAIL_INTENT_KEY: hex(),
        RUNTIME_ROLE: `quorem_hono_runtime_${env.GITHUB_SHA.slice(0, 24)}`,
        DATABASE_URL: original.databaseURL,
        LEGACY_APP_STATE: JSON.stringify(original.states.app),
      };
      keys.RUNTIME_PASSWORD = keys.STAGE_RUNTIME_DATABASE_PASSWORD;
      delete keys.STAGE_RUNTIME_DATABASE_PASSWORD;
      for (const key of [
        "SMTP_HOST",
        "SMTP_PORT",
        "SMTP_USERNAME",
        "SMTP_PASSWORD",
        "AUTH_EMAIL_FROM",
      ]) {
        if (!old[key]) throw new Error("Production mail configuration missing");
        keys[key] = old[key];
      }
    }
    tf(bootstrap, "secrets", keys);
    progress("snapshot-production-database");
    saved = await productionTerraform(bootstrap, "hono-production", "hono-production");
    keys = saved.secrets.value;
    console.log(JSON.stringify({ phase: "snapshot-preserved", branch: saved.backup_branch.value }));
    progress("resolve-validated-images");
    const images = productionImages(env);
    const native = { ...env };
    for (const [key, value] of Object.entries({
      deployment_scope: "production",
      account_id: env.CLOUDFLARE_ACCOUNT_ID,
      worker_name: "quorem-hono-production",
      stage_hostname: hosts.api,
      database_host: new URL(original.databaseURL).hostname,
      database_port: new URL(original.databaseURL).port || "5432",
      database_name: "neondb",
      database_user: keys.RUNTIME_ROLE,
      database_password: keys.RUNTIME_PASSWORD,
      database_connection_limit: "10",
      profile_media_enabled: "true",
      enable_queue_consumer: env.HONO_RESUME_PREPARED === "true" ? "true" : "false",
    }))
      tf(native, key, value);
    progress("provision-native-api-shell");
    await productionTerraform(native, "hono-stage", "hono-production-api", {
      targets: [
        "cloudflare_worker.api",
        "cloudflare_queue.execution",
        "cloudflare_queue.dead_letter",
        "cloudflare_r2_bucket.profile",
      ],
    });
    const maintenance = join(temporary, "maintenance.json");
    await writeFile(
      maintenance,
      JSON.stringify({
        name: "quorem-hono-production",
        main: resolve("deploy/hono/maintenance.js"),
        compatibility_date: "2026-10-23",
        workers_dev: false,
        preview_urls: false,
        routes: [{ pattern: hosts.api, zone_name: "quorem.app", custom_domain: true }],
      }),
      { mode: 0o600 },
    );
    runStageCommand(
        "vp",
        ["-C", "apps/api", "exec", "wrangler", "deploy", "--config", maintenance],
        env,
      );
    const services = { ...env };
    const serviceSecrets = Object.fromEntries(
      [
        "RECOVERY_CONTROL_SECRET",
        "QUOREM_RUNNER_COMMAND_SECRET",
        "QUOREM_RUNNER_DRAIN_SECRET",
        "QUOREM_CASE_SECRET",
        "QUOREM_VERIFICATION_SOURCE_KEY",
        "QUOREM_VERIFICATION_SERVICE_KEY",
        "IMAGE_SERVICE_TOKEN",
        "QUOREM_CASE_OWNER_PUBLIC_KEY_PEM",
        "QUOREM_VERIFICATION_SIGNING_KEY_PEM",
        "CASE_OWNER_PRIVATE_KEY",
        "MAIL_RELAY_TOKEN",
        "SMTP_HOST",
        "SMTP_PORT",
        "SMTP_USERNAME",
        "SMTP_PASSWORD",
        "AUTH_EMAIL_FROM",
      ].map((key) => [key, keys[key]]),
    );
    for (const [key, value] of Object.entries({
      deployment_scope: "production",
      account_id: env.CLOUDFLARE_ACCOUNT_ID,
      zone_id: env.CLOUDFLARE_ZONE_ID,
      cloudflare_api_token: env.CLOUDFLARE_API_TOKEN,
      worker_name: "quorem-hono-services-production",
      hostnames: { drain: hosts.drain, verifier: hosts.verifier, case: hosts.case },
      release_sha: env.GITHUB_SHA,
      release_generation: "1",
      profile_media_enabled: "true",
      image_hostname: hosts.image,
      image_service_image: images.image,
      mail_relay_enabled: "true",
      mail_relay_hostname: hosts.mail,
      mail_relay_image: images.mail,
      runner_image: images.runner,
      verifier_image: images.verifier,
      case_images: Object.fromEntries(
        ["python", "java", "typescript", "ocaml", "postgresql"].map((key) => [key, images[key]]),
      ),
      command_origin: `https://${hosts.api}`,
      source_origin: `https://${hosts.api}`,
      case_namespace_id: "0".repeat(64),
      case_diagnostics: "true",
      service_secrets: serviceSecrets,
    }))
      tf(services, key, value);
    progress("provision-native-private-services");
    runStageCommand(
      "terraform",
      terraformBackendArgs(env, "hono-services", "hono-production-services"),
      services,
    );
    const priorServices = JSON.parse(
      runStageCommand(
        "terraform",
        ["-chdir=infra/terraform/hono-services", "output", "-json"],
        services,
      ),
    );
    const pinned = priorServices.origins?.value?.QUOREM_CASE_NAMESPACE_ID;
    if (/^[a-f0-9]{64}$/.test(pinned ?? "") && pinned !== "0".repeat(64))
      tf(services, "case_namespace_id", pinned);
    if (env.HONO_RESUME_PREPARED !== "true")
      await productionTerraform(services, "hono-services", "hono-production-services");
    const publicKey = join(temporary, "case-owner.pem");
    await writeFile(publicKey, keys.QUOREM_CASE_OWNER_PUBLIC_KEY_PEM, { mode: 0o600 });
    let namespace;
    const deadline = Date.now() + 180000;
    while (!namespace && Date.now() < deadline) {
      try {
        namespace = await stageNamespace(
          {
            QUOREM_CASE_ORIGIN: `https://${hosts.case}`,
            QUOREM_CASE_SECRET: keys.QUOREM_CASE_SECRET,
            QUOREM_CASE_OWNER_PUBLIC_KEY_FILE: publicKey,
          },
          pinned ?? "0".repeat(64),
        );
      } catch {
        await pause(2000);
      }
    }
    if (!namespace) throw new Error("Production namespace unavailable");
    tf(services, "case_namespace_id", namespace.namespace);
    const privateOutput =
      env.HONO_RESUME_PREPARED === "true"
        ? priorServices
        : await productionTerraform(services, "hono-services", "hono-production-services");
    progress("mail-service-readiness");
    await waitHTTP(`https://${hosts.mail}/internal/mail/health`, 204, {
      authorization: `Bearer ${keys.MAIL_RELAY_TOKEN}`,
    });
    const legacy = { ...env };
    const configuration = (name) =>
      JSON.parse(original.resource("restapi_object", name).data).configuration;
    for (const [key, value] of Object.entries({
      account_id: env.CLOUDFLARE_ACCOUNT_ID,
      zone_id: env.CLOUDFLARE_ZONE_ID,
      domain: "quorem.app",
      worker_name: "quorem-production",
      api_worker_name: "quorem-hono-production",
      cloudflare_api_token: env.CLOUDFLARE_API_TOKEN,
      image: configuration("container").image,
      judge_image: configuration("judge_container").image,
      case_image_revision: "retained",
      database_url: original.databaseURL,
      better_auth_secret: old.BETTER_AUTH_SECRET,
      auth_internal_secret: old.AUTH_INTERNAL_SECRET,
      invite_key: old.QUOREM_INVITE_KEY,
    }))
      tf(legacy, key, value);
    progress("switch-public-api-to-maintenance");
    if (env.HONO_RESUME_PREPARED !== "true")
      await productionTerraform(legacy, "app", "app", {
        mode: "routes",
        targets: ["cloudflare_workers_route.api"],
      });
    const maintenanceCheck = await fetch("https://quorem.app/health", {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    const fenced =
      maintenanceCheck.status === 503 &&
      maintenanceCheck.headers.get("x-quorem-runtime") === "hono-maintenance";
    await maintenanceCheck.body?.cancel();
    if (!fenced) throw new Error("Public maintenance route unconfirmed");
    progress("retire-go-runtime");
    if (env.HONO_RESUME_PREPARED !== "true")
      await productionTerraform(legacy, "app", "app", {
        mode: "legacy-stop",
        destroy: true,
        targets: [
          "cloudflare_worker.app",
          "restapi_object.container",
          "restapi_object.judge_container",
          "restapi_object.fast_judge_container",
          "restapi_object.case_container",
          "cloudflare_queue_consumer.judge",
        ],
      });
    const assertLegacyStopped = async () => {
      for (const path of [
        "/workers/scripts/quorem-production",
        ...["container", "judge_container", "fast_judge_container", "case_container"].map(
          (name) => `/containers/applications/${original.resource("restapi_object", name).id}`,
        ),
      ]) {
        const response = await cloudflare(env, path);
        const absent = response.status === 404;
        await response.body?.cancel();
        if (!absent) throw new Error("Legacy runtime remains reachable");
      }
      return true;
    };
    await assertLegacyStopped();
    progress("migrate-retained-production-data");
    const operatorURL = new URL(original.databaseURL);
    operatorURL.search = "?sslmode=verify-full";
    const database = await transitionProductionDatabase(
      {
        databaseURL: operatorURL.href,
        authOrigin: "https://quorem.app",
        productionRunId: "41134339533",
        runtimeRole: keys.RUNTIME_ROLE,
        runtimePassword: keys.RUNTIME_PASSWORD,
        report: (record) =>
          console.log(JSON.stringify({ phase: "production-database-step", ...record })),
        assertLegacyStopped,
      },
      { backfillProblemVersions: operatorInputs },
    );
    console.log(
      JSON.stringify({
        phase: "production-data-migrated",
        versions: database.versions,
        batches: database.batches,
      }),
    );
    progress("provision-runtime-database-pool");
    const apiOutput = await productionTerraform(native, "hono-stage", "hono-production-api");
    const vars = {
      APP_ENV: "production",
      ALLOWED_ORIGINS: "https://quorem.app",
      AUTH_ORIGIN: "https://quorem.app",
      AUTH_MODE: "password",
      AUTH_PASSWORD_PRODUCTION: "true",
      AUTH_LOGIN_ONLY: old.AUTH_LOGIN_ONLY,
      AUTH_PASSKEYS: "true",
      AUTH_EMAIL_DRIVER: "relay",
      AUTH_EMAIL_FROM: old.AUTH_EMAIL_FROM,
      AUTH_EMAIL_RELAY_ORIGIN: `https://${hosts.mail}`,
      HTTP_MAX_REQUESTS: "32",
      DEADLINE_SHARDS: "8",
      GUEST_CREATION: old.GUEST_CREATION_ENABLED ?? "true",
      GUEST_ADMISSION: old.GUEST_ADMISSION_ENABLED ?? "true",
      GUEST_EXECUTION: old.GUEST_EXECUTION_ENABLED ?? "true",
      TRUST_CLOUDFLARE_PEER: "true",
      SOCKET_HEARTBEAT_MS: "15000",
      PROFILE_MEDIA_ENABLED: "true",
      PROFILE_IMAGE_SERVICE_URL: `https://${hosts.image}`,
      PROFILE_IMAGE_ACCESS_MODE: "none",
      VERIFICATION_SERVICE_ORIGIN: `https://${hosts.verifier}`,
      VERIFICATION_ACCESS_MODE: "none",
      VERIFICATION_PUBLIC_KEY: keys.VERIFICATION_PUBLIC_KEY,
      EXECUTION_DRAIN_URL: `https://${hosts.drain}/internal/drain`,
      EXECUTION_DRAIN_ACCESS_MODE: "none",
      GOOGLE_CLIENT_ID: old.GOOGLE_CLIENT_ID,
      GITHUB_CLIENT_ID: old.GITHUB_CLIENT_ID,
    };
    const secrets = {
      MATCH_INVITE_KEY: keys.MATCH_INVITE_KEY,
      BETTER_AUTH_SECRET: keys.BETTER_AUTH_SECRET,
      AUTH_INTERNAL_SECRET: keys.AUTH_INTERNAL_SECRET,
      AUTH_MAIL_INTENT_KEY: keys.AUTH_MAIL_INTENT_KEY,
      AUTH_EMAIL_RELAY_TOKEN: keys.MAIL_RELAY_TOKEN,
      GOOGLE_CLIENT_SECRET: old.GOOGLE_CLIENT_SECRET,
      GITHUB_CLIENT_SECRET: old.GITHUB_CLIENT_SECRET,
      PROFILE_IMAGE_SERVICE_TOKEN: keys.IMAGE_SERVICE_TOKEN,
      RUNNER_PEERS: JSON.stringify([
        { secret: keys.QUOREM_RUNNER_COMMAND_SECRET, scope: namespace.scope, resumable: true },
      ]),
      VERIFICATION_SOURCE_CREDENTIAL: keys.QUOREM_VERIFICATION_SOURCE_KEY,
      VERIFICATION_SERVICE_CREDENTIAL: keys.QUOREM_VERIFICATION_SERVICE_KEY,
      EXECUTION_DRAIN_SECRET: keys.QUOREM_RUNNER_DRAIN_SECRET,
    };
    checkWorkerAuth(vars, secrets, true);
    const apiConfig = workerConfig(
      { stageZone: "quorem.app", vars },
      { ...apiOutput, services: privateOutput },
      join(temporary, "native.json"),
      "production",
    );
    const configFile = join(temporary, "native.json");
    await writeFile(configFile, JSON.stringify(apiConfig), { mode: 0o600 });
    putWorkerSecrets("quorem-hono-production", secrets, env);
    progress("activate-native-execution-controls");
    const controls = await stageControls({
      namespace: namespace.namespace,
      scope: namespace.scope,
      release: privateOutput.origins.value.SERVICES_RELEASE,
      bindings: privateOutput.origins.value.SERVICES_BINDINGS,
      secret: keys.RECOVERY_CONTROL_SECRET,
      caseOrigin: `https://${hosts.case}`,
      runnerOrigin: `https://${hosts.drain}`,
      publicKeyFile: publicKey,
    });
    const runner = await controls.runnerState();
    if (runner.status === "active") await controls.requireActive(1);
    else await controls.activate();
    progress("attach-native-execution-queue");
    tf(native, "enable_queue_consumer", "true");
    await productionTerraform(native, "hono-stage", "hono-production-api", {
      targets: ["cloudflare_queue_consumer.execution"],
    });
    progress("deploy-native-production-api");
    runStageCommand(
      "vp",
      ["-C", "apps/api", "exec", "wrangler", "deploy", "--config", configFile],
      env,
    );
    await waitHTTP("https://quorem.app/health", 200);
    const authReady = await fetch("https://quorem.app/api/auth/quorem-config", {
      signal: AbortSignal.timeout(15000),
    });
    const ready = authReady.status === 200;
    await authReady.body?.cancel();
    if (!ready) {
      const error = new Error("Native auth unavailable");
      error.diagnostic = await workerDiagnostic(env, "quorem-hono-production", "https://quorem.app");
      throw error;
    }
    progress("record-native-activation");
    tf(bootstrap, "phase", "active");
    await productionTerraform(bootstrap, "hono-production", "hono-production");
    return {
      release: env.GITHUB_SHA,
      origin: "https://quorem.app",
      runtime: "hono",
      backup: saved.backup_branch.value,
      legacyStopped: true,
      databaseMigrated: true,
      queueAttached: true,
      additionalTestsSkipped: true,
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
if (import.meta.main) {
  try {
    console.log(JSON.stringify(await deployProduction(process.env)));
  } catch (error) {
    console.error(
      JSON.stringify({
        error: "production-cutover-failed",
        phase,
        code: /^[A-Z0-9]{5}$/.test(error?.code ?? "") ? error.code : undefined,
        diagnostic: error.diagnostic,
        frames: error.stack
          ?.split("\n")
          .slice(1, 6)
          .map((line) => line.match(/at ([A-Za-z0-9_.]+)/)?.[1])
          .filter(Boolean),
        provider:
          error instanceof StageCommandFailure
            ? {
                category: error.category,
                spawnCode: error.spawnCode,
                resources: error.resources,
                diagnostics: error.diagnostics,
              }
            : undefined,
        reason: [
          "Production identity mismatch",
          "Production key continuity mismatch",
          "Production jobs must drain before cutover",
          "Referenced production photos require object copy",
          "Public maintenance route unconfirmed",
          "Legacy runtime remains reachable",
          "Migration artifact verification failed",
          "GitHub verification unavailable",
          "Local migration artifact mismatch",
          "Verified operator binding required",
          "Operator mismatch",
          "Backfill incomplete",
          "Problem version backfill incomplete",
        ].includes(error.message)
          ? error.message
          : undefined,
      }),
    );
    process.exitCode = 1;
  }
}
