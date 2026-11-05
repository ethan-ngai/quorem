/** Update the active judge generation without reprovisioning the API or database. */
import { createHash, createPublicKey } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { terraformBackendArgs } from "./hono-terraform-backend.mjs";
import { runStageCommand } from "./hono-stage-command.mjs";
import { productionTerraform } from "./hono-production-terraform.mjs";
import { productionImages, validatedJudgeImages } from "./hono-production-images.mjs";
import { stageNamespace } from "./hono-stage-deploy-proof.mjs";
import { stageControls } from "./hono-stage-controls.mjs";
import { judgingScopeIdle } from "./hono-judging-release.mjs";
import { benchmarkProductionWorkload } from "./hono-production-workload.mjs";
import { benchmarkProductionPython } from "./hono-production-benchmark.mjs";

const { Client } = createRequire(new URL("../packages/database/package.json", import.meta.url))(
  "pg",
);
const { verifyPassword } = createRequire(new URL("../apps/auth/package.json", import.meta.url))(
  "better-auth/crypto",
);
const hosts = {
  drain: "runner-hono.quorem.app",
  verifier: "verifier-hono.quorem.app",
  case: "case-hono.quorem.app",
};
const scope = { directory: "hono-services", key: "hono-production-services" };
const report = (phase) => console.log(JSON.stringify({ phase }));
const op = (release, label) => {
  const hash = createHash("sha256").update(`${release}:${label}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};

function outputs(env, directory, key) {
  runStageCommand("terraform", terraformBackendArgs(env, directory, key), env);
  return JSON.parse(
    runStageCommand("terraform", [`-chdir=infra/terraform/${directory}`, "output", "-json"], env),
  );
}

async function quiesce(db) {
  const deadline = Date.now() + 90000;
  let idleSince;
  do {
    const idle = await judgingScopeIdle(db);
    if (!idle) idleSince = undefined;
    else idleSince ??= Date.now();
    // Require a stable idle interval before advancing release ownership.
    if (idleSince && Date.now() - idleSince >= 20000) return;
    await delay(1000);
  } while (Date.now() < deadline);
  throw new Error("Execution attempts did not quiesce");
}

async function rollout(env, benchmarkOnly) {
  const release = env.GITHUB_SHA;
  if (
    env.GITHUB_REF !== (benchmarkOnly ? "refs/heads/dev" : "refs/heads/main") ||
    release !== env.HONO_RELEASE_SHA ||
    !/^[0-9a-f]{40}$/.test(release ?? "")
  )
    throw new Error("Exact main release required");
  report("read-active-production");
  const bootstrap = outputs(env, "hono-production", "hono-production");
  if (bootstrap.activation?.value?.phase !== "active")
    throw new Error("Native production is inactive");
  const keys = bootstrap.secrets.value;
  const database = new URL(keys.DATABASE_URL);
  if (database.pathname !== "/neondb" || !database.hostname.endsWith(".neon.tech"))
    throw new Error("Unexpected production database");
  database.search = "?sslmode=verify-full";
  const db = new Client({
    connectionString: database.href,
    connectionTimeoutMillis: 10000,
    query_timeout: 10000,
  });
  const priorOutput = outputs(env, scope.directory, scope.key).origins.value;
  if (
    priorOutput.QUOREM_RUNNER_COMMAND_ORIGIN !== "https://api-hono.quorem.app" ||
    priorOutput.QUOREM_VERIFICATION_SOURCE_ORIGIN !== "https://api-hono.quorem.app"
  )
    throw new Error("Unexpected private production API origins");
  const publicKey = keys.QUOREM_CASE_OWNER_PUBLIC_KEY_PEM;
  if (createPublicKey(publicKey).asymmetricKeyType !== "ed25519")
    throw new Error("Invalid case owner key");
  const temporary = await mkdtemp(join(tmpdir(), "quorem-private-release-"));
  try {
    await db.connect();
    const publicKeyFile = join(temporary, "owner.pem");
    await writeFile(publicKeyFile, publicKey, { mode: 0o600 });
    const namespace = await stageNamespace(
      {
        QUOREM_CASE_ORIGIN: `https://${hosts.case}`,
        QUOREM_CASE_SECRET: keys.QUOREM_CASE_SECRET,
        QUOREM_CASE_OWNER_PUBLIC_KEY_FILE: publicKeyFile,
      },
      priorOutput.QUOREM_CASE_NAMESPACE_ID,
    );
    const controls = (targetRelease, bindings) =>
      stageControls({
        namespace: namespace.namespace,
        scope: namespace.controlScope,
        release: targetRelease,
        bindings,
        secret: keys.RECOVERY_CONTROL_SECRET,
        caseOrigin: `https://${hosts.case}`,
        runnerOrigin: `https://${hosts.drain}`,
        publicKeyFile,
      });
    const current = await controls(priorOutput.SERVICES_RELEASE, priorOutput.SERVICES_BINDINGS);
    const { runner, cases } = await current.observe();
    const benchmarkEnv = { ...env };
    if (env.JUDGING_WORKLOAD === "true") {
      benchmarkEnv.DATABASE_URL = database.href;
      benchmarkEnv.BETTER_AUTH_SECRET = keys.BETTER_AUTH_SECRET ?? env.BETTER_AUTH_SECRET;
    }
    if (!benchmarkEnv.AUTH_BOOTSTRAP_USERNAME) {
      const { rows } = await db.query(`SELECT DISTINCT a.username, c.password
        FROM quorem_auth."user" a
        JOIN quorem_auth.account c ON c."userId"=a.id AND c."providerId"='credential'
        JOIN identity_bindings b ON b.subject=a.id
        JOIN users u ON u.id=b.user_id
        WHERE u.role='admin' AND NOT u.disabled AND a.username IS NOT NULL AND c.password IS NOT NULL
        LIMIT 21`);
      if (env.AUTH_BOOTSTRAP_PASSWORD && rows.length <= 20) {
        const matches = [];
        for (const row of rows)
          if (await verifyPassword({ hash: row.password, password: env.AUTH_BOOTSTRAP_PASSWORD }))
            matches.push(row.username);
        if (matches.length === 1) benchmarkEnv.AUTH_BOOTSTRAP_USERNAME = matches[0];
      }
    }
    if (benchmarkOnly || (runner.status === "active" && runner.release === release)) {
      await current.requireActive(runner.generation);
      return benchmarkEnv;
    }
    const caseOperation = op(release, "activate-case");
    const caseAdvanced = cases.release === release && cases.activationOperation === caseOperation;
    const generation = caseAdvanced ? cases.generation : cases.generation + 1;
    const prior = { ...cases, generation: generation - 1 };
    const runnerOperation = op(release, "pause-runner"),
      pauseCase = op(release, "pause-case");
    if (
      caseAdvanced &&
      !(
        runner.status === "prepared" &&
        runner.release === release &&
        runner.generation === generation
      )
    )
      throw new Error("Unexpected advanced controls");
    if (!caseAdvanced && cases.paused && cases.pauseOperation !== pauseCase)
      throw new Error("Another operation paused case execution");
    if (!caseAdvanced && !cases.paused) await current.requireActive(prior.generation);
    const {
      rows: [inputBounds],
    } = await db.query(
      "SELECT COALESCE(MAX(octet_length(data)),0) <= 8388608 AS bounded FROM runner_input_blobs",
    );
    if (inputBounds.bounded !== true)
      throw new Error("Retained runner input exceeds validated size");
    const images = env.HONO_JUDGE_VALIDATION_RUN
      ? validatedJudgeImages(env, env.HONO_JUDGE_VALIDATION_RUN)
      : productionImages(env, { reuseMail: true });
    const secretNames = [
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
    ];
    const vars = {
      deployment_scope: "production",
      account_id: env.CLOUDFLARE_ACCOUNT_ID,
      zone_id: env.CLOUDFLARE_ZONE_ID,
      cloudflare_api_token: env.CLOUDFLARE_API_TOKEN,
      worker_name: "quorem-hono-services-production",
      hostnames: hosts,
      release_sha: release,
      release_generation: String(generation),
      profile_media_enabled: "true",
      image_hostname: "image-hono.quorem.app",
      image_service_image: images.image,
      mail_relay_enabled: "true",
      mail_relay_hostname: "mail-hono.quorem.app",
      mail_relay_image: images.mail,
      case_images: Object.fromEntries(
        ["python", "java", "typescript", "ocaml", "postgresql"].map((language) => [
          language,
          images[language],
        ]),
      ),
      command_origin: priorOutput.QUOREM_RUNNER_COMMAND_ORIGIN,
      source_origin: priorOutput.QUOREM_VERIFICATION_SOURCE_ORIGIN,
      case_namespace_id: namespace.namespace,
      case_diagnostics: "true",
      service_secrets: Object.fromEntries(secretNames.map((name) => [name, keys[name]])),
    };
    const child = {
      ...env,
      ...Object.fromEntries(
        Object.entries(vars).map(([name, value]) => [
          `TF_VAR_${name}`,
          typeof value === "string" ? value : JSON.stringify(value),
        ]),
      ),
    };
    const result = (
      await productionTerraform(child, scope.directory, scope.key, {
        mode: "private-workers",
        async beforeApply() {
          if (caseAdvanced || runner.status === "prepared") return;
          if (!cases.paused && runner.status === "active") {
            report("wait-for-idle-judge");
            await quiesce(db);
          }
          report("pause-and-quiesce-judge");
          await current.pausePinned({ prior, runnerOperation, caseOperation: pauseCase });
          await quiesce(db);
        },
      })
    ).origins.value;
    if (
      result.SERVICES_RELEASE !== release ||
      Number(result.SERVICES_GENERATION) !== generation ||
      result.QUOREM_CASE_NAMESPACE_ID !== namespace.namespace
    )
      throw new Error("Unexpected deployed services");
    report("verify-verifier-domain");
    const verifierDeadline = Date.now() + 120000;
    for (;;) {
      let ready = false;
      try {
        const probe = await fetch(`https://${hosts.verifier}/internal/results/verify`, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(5000),
        });
        ready = probe.status === 401;
        await probe.body?.cancel();
      } catch {}
      if (ready) break;
      if (Date.now() >= verifierDeadline) throw new Error("Verifier domain unavailable");
      await delay(2000);
    }
    report("update-api-with-private-workers-paused");
    runStageCommand("vp", ["exec", "node", "scripts/hono-production-api-release.mjs"], {
      ...env,
      HONO_JUDGING_SCOPE_UPDATE: "true",
    });
    report("activate-private-workers");
    const next = await controls(release, result.SERVICES_BINDINGS);
    const prepared = await next.prepareResume({
      prior,
      operation: op(release, "prepare-runner"),
      caseOperation,
    });
    await next.activateCaseResume({ prior, operation: caseOperation });
    await next.activateRunnerResume({
      prior,
      operation: op(release, "activate-runner"),
      caseOperation,
      token: prepared.token,
    });
    await next.requireActive(generation);
    console.log(JSON.stringify({ phase: "private-workers-active", release, generation }));
    return benchmarkEnv;
  } finally {
    await db.end().catch(() => {});
    await rm(temporary, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    const benchmarkEnv = await rollout(process.env, process.argv.includes("--benchmark-only"));
    report("benchmark-python");
    const result =
      process.env.JUDGING_WORKLOAD === "true"
        ? await benchmarkProductionWorkload(benchmarkEnv)
        : await benchmarkProductionPython(benchmarkEnv);
    console.log(JSON.stringify(result));
    if (result.meetsTarget === false) process.exitCode = 1;
  } catch (error) {
    console.error(
      JSON.stringify({
        error: "private-worker-release-failed",
        reason: /^[A-Za-z -]{1,90}$/.test(error?.message ?? "") ? error.message : undefined,
        planChange: error?.planChange,
        status: Number.isInteger(error?.status) ? error.status : undefined,
        control:
          error?.kind && error?.action
            ? [error.kind, error.action, error.reason, error.status]
            : undefined,
      }),
    );
    process.exitCode = 1;
  }
}
