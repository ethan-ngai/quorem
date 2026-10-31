import { stageControls } from "./hono-stage-controls.mjs";
import { requireFreshStageResources } from "./hono-stage-freshness.mjs";
import { provisionStageDatabaseRole, stageRoleCredentials } from "./hono-stage-database-role.mjs";
/** First staged activation; existing database updates require a separate cutover contract. */
import { spawnSync } from "node:child_process";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createStagedActor } from "../apps/api/src/runtime/composition/fixtures/staged-actor.ts";
import { stageConfig } from "./hono-stage-config.mjs";
import { checkStagePreflight, checkWorkerAuth } from "./hono-stage-preflight.mjs";
import { checkSecrets } from "./hono-stage-secrets.mjs";
import { keyBytes } from "../apps/api/src/runtime/composition/config.ts";
import { validateStageRequest, terraformInitArgs } from "./hono-stage-deploy.mjs";
import { requireFreshStageDatabase } from "./hono-stage-deploy-database.mjs";
import { publishImages } from "./hono-stage-deploy-images.mjs";
import { stageNamespace } from "./hono-stage-deploy-proof.mjs";
import { uploadWorkerSecrets } from "./hono-stage-deploy-secrets.mjs";
import { releaseQueue, setQueue } from "./hono-stage-deploy-queue.mjs";
import { verifyNoAlternateIngress } from "./hono-stage-deploy-subdomains.mjs";

const commonNames = [
  "PATH",
  "HOME",
  "USER",
  "TMPDIR",
  "CI",
  "NODE_EXTRA_CA_CERTS",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "TF_IN_AUTOMATION",
];
const stackNames = {
  "hono-stage": [
    "account_id",
    "zone_id",
    "dns_target",
    "worker_name",
    "stage_hostname",
    "drain_hostname",
    "access_service_token_ids",
    "drain_access_service_token_id",
    "database_host",
    "database_port",
    "database_name",
    "database_user",
    "database_password",
    "database_connection_limit",
    "profile_media_enabled",
    "enable_queue_consumer",
  ],
  "hono-services": [
    "account_id",
    "zone_id",
    "cloudflare_api_token",
    "worker_name",
    "hostnames",
    "dns_target",
    "profile_media_enabled",
    "image_hostname",
    "image_access_service_token_id",
    "image_service_image",
    "access_token_ids",
    "runner_image",
    "verifier_image",
    "case_images",
    "command_origin",
    "source_origin",
    "case_namespace_id",
    "case_diagnostics",
    "release_sha",
    "release_generation",
    "service_secrets",
  ],
};
function selected(env, names) {
  return Object.fromEntries(
    names.filter((name) => env[name] !== undefined).map((name) => [name, env[name]]),
  );
}
function command(cmd, args, env, input) {
  const result = spawnSync(cmd, args, {
    env,
    input,
    encoding: "utf8",
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error("Stage command failed; output withheld");
  return result.stdout ?? "";
}
function tfEnv(env, stack) {
  const values = selected(env, [
    ...commonNames,
    ...stackNames[stack].map((name) => `TF_VAR_${name}`),
  ]);
  if (stack === "hono-services") values.TF_VAR_worker_name = env.HONO_SERVICES_WORKER_NAME;
  return values;
}
function terraform(env, stack, operation) {
  const args =
    operation === "init"
      ? terraformInitArgs(env, stack)
      : [
          `-chdir=infra/terraform/${stack}`,
          operation,
          "-input=false",
          ...(operation === "apply"
            ? ["-auto-approve", "-lock-timeout=5m"]
            : operation === "plan"
              ? ["-no-color", "-lock-timeout=5m"]
              : []),
        ];
  return command("terraform", args, tfEnv(env, stack));
}
function terraformOutputs(env) {
  return JSON.parse(
    command(
      "terraform",
      ["-chdir=infra/terraform/hono-stage", "output", "-json"],
      tfEnv(env, "hono-stage"),
    ),
  );
}
function servicesOutputs(env) {
  return JSON.parse(
    command(
      "terraform",
      ["-chdir=infra/terraform/hono-services", "output", "-json"],
      tfEnv(env, "hono-services"),
    ),
  );
}
function migrate(env) {
  const child = {
    ...selected(env, ["PATH", "HOME", "USER", "TMPDIR", "CI", "NODE_EXTRA_CA_CERTS"]),
    DATABASE_URL: env.HONO_STAGE_DATABASE_URL,
  };
  for (const [owner, dir] of [
    ["product", "apps/api/migrations"],
    ["auth", "apps/auth/migrations"],
  ])
    command("vp", ["exec", "node", "packages/database/src/migrate.ts", owner, dir], child);
}
function workerDeploy(configFile, env) {
  const child = selected(env, [
    "PATH",
    "HOME",
    "USER",
    "TMPDIR",
    "CI",
    "NODE_EXTRA_CA_CERTS",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
  ]);
  command("vp", ["-C", "apps/api", "exec", "wrangler", "deploy", "--config", configFile], child);
}
function remoteProof(env) {
  const child = selected(env, [
    "PATH",
    "HOME",
    "USER",
    "TMPDIR",
    "CI",
    "NODE_EXTRA_CA_CERTS",
    "QUOREM_REMOTE_VALIDATION_DATABASE_URL",
    "QUOREM_CASE_ORIGIN",
    "QUOREM_CASE_SECRET",
    "QUOREM_CASE_NAMESPACE_ID",
    "QUOREM_CASE_OWNER_PUBLIC_KEY_FILE",
    "QUOREM_CASE_ACCESS_CLIENT_ID",
    "QUOREM_CASE_ACCESS_CLIENT_SECRET",
  ]);
  command("vp", ["exec", "node", "scripts/hono-remote-validation.mjs"], child);
}
const defaults = {
  freshness: requireFreshStageResources,
  roleConfig: stageRoleCredentials,
  fresh: requireFreshStageDatabase,
  migrate,
  databaseRole: provisionStageDatabaseRole,
  images: publishImages,
  terraform,
  outputs: terraformOutputs,
  servicesOutputs,
  controls: stageControls,
  probe: stageNamespace,
  upload: uploadWorkerSecrets,
  deploy: workerDeploy,
  remote: remoteProof,
  actor: createStagedActor,
  queue: releaseQueue,
  subdomains: verifyNoAlternateIngress,
  detach: (env) => setQueue(env, false),
  cleanup: (dir) => rm(dir, { recursive: true, force: true }),
};

export async function deployStage(original, operations = defaults) {
  validateStageRequest(original);
  if (original.HONO_STAGE_ACTION !== "stage") throw new Error("Explicit stage action required");
  const publicInput = JSON.parse(original.HONO_STAGE_PUBLIC_JSON),
    services = JSON.parse(original.TF_VAR_service_secrets),
    supplied = JSON.parse(original.HONO_WORKER_SECRETS_JSON),
    hosts = JSON.parse(original.TF_VAR_hostnames);
  if (
    publicInput.vars?.AUTH_ORIGIN !== original.TF_VAR_command_origin ||
    publicInput.vars?.VERIFICATION_SERVICE_ORIGIN !== `https://${hosts.verifier}` ||
    publicInput.vars?.EXECUTION_DRAIN_URL !== `https://${hosts.drain}/internal/drain`
  )
    throw new Error("Stage service origins do not match");
  const profileEnabled = (original.TF_VAR_profile_media_enabled ?? "false") === "true";
  if ((publicInput.vars?.PROFILE_MEDIA_ENABLED ?? "false") !== String(profileEnabled))
    throw new Error("Profile feature flags differ");
  if (
    profileEnabled &&
    (publicInput.vars.PROFILE_IMAGE_SERVICE_URL !== `https://${original.TF_VAR_image_hostname}` ||
      publicInput.vars.PROFILE_IMAGE_ACCESS_MODE !== "cloudflare-access" ||
      supplied.PROFILE_IMAGE_SERVICE_TOKEN !== services.IMAGE_SERVICE_TOKEN)
  )
    throw new Error("Image service configuration differs");
  if (!publicInput.vars?.ALLOWED_ORIGINS?.split(",").includes(original.HONO_STAGE_BROWSER_ORIGIN))
    throw new Error("Invalid stage browser origin");
  keyBytes(supplied.MATCH_INVITE_KEY);
  checkWorkerAuth(publicInput.vars, supplied, profileEnabled);
  // The provisional scope validates credentials only; authority comes from the signed probe.
  const preflightSecrets = {
    ...supplied,
    RUNNER_PEERS: JSON.stringify([
      { secret: services.QUOREM_RUNNER_COMMAND_SECRET, scope: "preflight-only", resumable: true },
    ]),
    VERIFICATION_SOURCE_CREDENTIAL: services.QUOREM_VERIFICATION_SOURCE_KEY,
    VERIFICATION_SERVICE_CREDENTIAL: services.QUOREM_VERIFICATION_SERVICE_KEY,
    EXECUTION_DRAIN_SECRET: services.QUOREM_RUNNER_DRAIN_SECRET,
    CLOUDFLARE_ACCESS_CLIENT_ID: services.RUNNER_API_ACCESS_CLIENT_ID,
    CLOUDFLARE_ACCESS_CLIENT_SECRET: services.RUNNER_API_ACCESS_CLIENT_SECRET,
  };
  checkSecrets(preflightSecrets);
  const extra = [
    services.RECOVERY_CONTROL_SECRET,
    services.QUOREM_CASE_SECRET,
    services.QUOREM_CASE_ACCESS_CLIENT_SECRET,
    services.VERIFIER_API_ACCESS_CLIENT_SECRET,
    services.RUNNER_API_ACCESS_CLIENT_SECRET,
    services.QUOREM_RUNNER_COMMAND_SECRET,
    services.QUOREM_VERIFICATION_SOURCE_KEY,
    services.QUOREM_VERIFICATION_SERVICE_KEY,
    services.QUOREM_RUNNER_DRAIN_SECRET,
    supplied.VERIFICATION_ACCESS_CLIENT_SECRET,
    supplied.EXECUTION_DRAIN_ACCESS_CLIENT_SECRET,
  ];
  if (profileEnabled)
    extra.push(services.IMAGE_SERVICE_TOKEN, supplied.PROFILE_IMAGE_ACCESS_CLIENT_SECRET);
  if (
    extra.some((value) => typeof value !== "string" || !value || /\s/.test(value)) ||
    new Set(extra).size !== extra.length ||
    Object.values(supplied).includes(services.RECOVERY_CONTROL_SECRET) ||
    new TextEncoder().encode(services.QUOREM_CASE_SECRET).length < 32 ||
    new TextEncoder().encode(services.RECOVERY_CONTROL_SECRET).length < 32 ||
    publicInput.vars.EXECUTION_DRAIN_ACCESS_MODE !== "cloudflare-access" ||
    !supplied.EXECUTION_DRAIN_ACCESS_CLIENT_ID ||
    !services.QUOREM_CASE_ACCESS_CLIENT_ID ||
    !services.VERIFIER_API_ACCESS_CLIENT_ID
  )
    throw new Error("Invalid private service credentials");
  try {
    const casePrivate = createPrivateKey({
      key: Buffer.from(services.CASE_OWNER_PRIVATE_KEY, "base64"),
      format: "der",
      type: "pkcs8",
    });
    const casePublic = createPublicKey(services.QUOREM_CASE_OWNER_PUBLIC_KEY_PEM);
    const verifierPrivate = createPrivateKey(services.QUOREM_VERIFICATION_SIGNING_KEY_PEM);
    const der = (key) =>
      createPublicKey(key).export({ type: "spki", format: "der" }).toString("base64");
    if (
      casePrivate.asymmetricKeyType !== "ed25519" ||
      casePublic.asymmetricKeyType !== "ed25519" ||
      verifierPrivate.asymmetricKeyType !== "ed25519" ||
      der(casePrivate) !== casePublic.export({ type: "spki", format: "der" }).toString("base64") ||
      der(verifierPrivate) !== publicInput.vars.VERIFICATION_PUBLIC_KEY
    )
      throw new Error();
  } catch {
    throw new Error("Invalid staged signing keys");
  }
  const freshResources = await operations.freshness(original);
  operations.roleConfig(original);
  await operations.fresh(original);
  const env = {
    ...original,
    TF_VAR_enable_queue_consumer: "false",
    TF_VAR_case_diagnostics: "true",
    TF_VAR_release_sha: original.HONO_RELEASE_SHA,
    TF_VAR_release_generation: "1",
  };
  const temp = await mkdtemp(join(tmpdir(), "quorem-stage-deploy-"));
  let actor,
    receipt,
    failure,
    cleanupFailed = false,
    queueAttached = false,
    controlClient,
    controlsAttempted = false;
  try {
    const keyFile = join(temp, "case-public.pem");
    await writeFile(keyFile, services.QUOREM_CASE_OWNER_PUBLIC_KEY_PEM, { mode: 0o600 });
    const caseEnv = {
      ...env,
      QUOREM_CASE_ORIGIN: `https://${hosts.case}`,
      QUOREM_CASE_SECRET: services.QUOREM_CASE_SECRET,
      QUOREM_CASE_ACCESS_CLIENT_ID: services.QUOREM_CASE_ACCESS_CLIENT_ID,
      QUOREM_CASE_ACCESS_CLIENT_SECRET: services.QUOREM_CASE_ACCESS_CLIENT_SECRET,
      QUOREM_CASE_OWNER_PUBLIC_KEY_FILE: keyFile,
    };
    await Promise.resolve(operations.terraform(env, "hono-services", "init"));
    await Promise.resolve(operations.terraform(env, "hono-services", "plan"));
    if (env.TF_VAR_case_namespace_id !== "0".repeat(64))
      await operations.probe(caseEnv, env.TF_VAR_case_namespace_id);
    await Promise.resolve(operations.terraform(env, "hono-stage", "init"));
    await Promise.resolve(operations.migrate(original));
    await operations.databaseRole(original);
    await Promise.resolve(operations.terraform(env, "hono-stage", "apply"));
    const images = await Promise.resolve(operations.images(original));
    env.TF_VAR_runner_image = images.runner;
    env.TF_VAR_verifier_image = images.verifier;
    if (profileEnabled) env.TF_VAR_image_service_image = images.image;
    env.TF_VAR_case_images = JSON.stringify(
      Object.fromEntries(
        ["python", "java", "typescript", "ocaml", "postgresql"].map((name) => [name, images[name]]),
      ),
    );
    Object.assign(caseEnv, {
      TF_VAR_runner_image: env.TF_VAR_runner_image,
      TF_VAR_verifier_image: env.TF_VAR_verifier_image,
      ...(profileEnabled ? { TF_VAR_image_service_image: env.TF_VAR_image_service_image } : {}),
      TF_VAR_case_images: env.TF_VAR_case_images,
    });
    validateStageRequest(env);
    await Promise.resolve(operations.terraform(env, "hono-services", "apply"));
    const verified = await operations.probe(caseEnv, env.TF_VAR_case_namespace_id);
    env.TF_VAR_case_namespace_id = verified.namespace;
    caseEnv.TF_VAR_case_namespace_id = verified.namespace;
    caseEnv.QUOREM_CASE_NAMESPACE_ID = verified.namespace;
    await Promise.resolve(operations.terraform(env, "hono-services", "apply"));
    const workerSecrets = {
      ...supplied,
      RUNNER_PEERS: JSON.stringify([
        { secret: services.QUOREM_RUNNER_COMMAND_SECRET, scope: verified.scope, resumable: true },
      ]),
      VERIFICATION_SOURCE_CREDENTIAL: services.QUOREM_VERIFICATION_SOURCE_KEY,
      VERIFICATION_SERVICE_CREDENTIAL: services.QUOREM_VERIFICATION_SERVICE_KEY,
      EXECUTION_DRAIN_SECRET: services.QUOREM_RUNNER_DRAIN_SECRET,
      CLOUDFLARE_ACCESS_CLIENT_ID: services.RUNNER_API_ACCESS_CLIENT_ID,
      CLOUDFLARE_ACCESS_CLIENT_SECRET: services.RUNNER_API_ACCESS_CLIENT_SECRET,
    };
    const outputs = await Promise.resolve(operations.outputs(env));
    const configFile = join(temp, "wrangler.json");
    const config = stageConfig(publicInput, outputs, configFile);
    await writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
    checkStagePreflight(publicInput, outputs, workerSecrets);
    await Promise.resolve(operations.deploy(configFile, env));
    await Promise.resolve(operations.upload(publicInput, outputs, workerSecrets, env));
    await operations.subdomains(env);
    const serviceOutput = await Promise.resolve(operations.servicesOutputs(env));
    const controlVars = serviceOutput?.origins?.value;
    if (
      controlVars?.SERVICES_RELEASE !== env.HONO_RELEASE_SHA ||
      String(controlVars?.SERVICES_GENERATION) !== "1" ||
      !/^[a-f0-9]{64}$/.test(controlVars?.SERVICES_BINDINGS ?? "")
    )
      throw new Error("Invalid services control output");
    controlClient = await operations.controls({
      namespace: verified.namespace,
      scope: verified.scope,
      release: env.HONO_RELEASE_SHA,
      bindings: controlVars.SERVICES_BINDINGS,
      secret: services.RECOVERY_CONTROL_SECRET,
      caseOrigin: `https://${hosts.case}`,
      runnerOrigin: `https://${hosts.drain}`,
      caseAccess: {
        id: services.QUOREM_CASE_ACCESS_CLIENT_ID,
        secret: services.QUOREM_CASE_ACCESS_CLIENT_SECRET,
      },
      runnerAccess: {
        id: supplied.EXECUTION_DRAIN_ACCESS_CLIENT_ID,
        secret: supplied.EXECUTION_DRAIN_ACCESS_CLIENT_SECRET,
      },
      publicKeyFile: keyFile,
    });
    controlsAttempted = true;
    const controlReceipt = await controlClient.activate();
    await Promise.resolve(operations.remote(caseEnv));
    actor = await operations.actor({
      databaseURL: env.HONO_STAGE_DATABASE_URL,
      authOrigin: publicInput.vars.AUTH_ORIGIN,
      authSecret: workerSecrets.BETTER_AUTH_SECRET,
      mode: "stage",
    });
    const acceptance = await operations.queue(
      {
        ...env,
        ...caseEnv,
        ...workerSecrets,
        ...publicInput.vars,
        HONO_STAGE_API_ORIGIN: publicInput.vars.AUTH_ORIGIN,
        HONO_DRAIN_ORIGIN: `https://${hosts.drain}`,
        HONO_STAGE_SESSION_COOKIE: actor.sessionCookie,
        HONO_STAGE_PROBLEM_VERSION_ID: actor.problemVersionId,
        HONO_STAGE_ACCEPT_SOURCE: actor.acceptedSource,
      },
      verified.namespace,
    );
    queueAttached = true;
    receipt = {
      release: env.HONO_RELEASE_SHA,
      database: "fresh",
      freshResources,
      controls: controlReceipt,
      namespace: verified.namespace,
      images,
      acceptance,
      cutoverReady: false,
    };
  } catch (error) {
    failure = error;
  } finally {
    try {
      await actor?.dispose();
    } catch {
      cleanupFailed = true;
    }
    try {
      await operations.cleanup(temp);
    } catch {
      cleanupFailed = true;
    }
  }
  if (failure || cleanupFailed) {
    let detachFailed = false,
      pauseFailed = false;
    if (controlsAttempted || queueAttached) {
      try {
        await Promise.resolve(operations.detach(env));
      } catch {
        detachFailed = true;
      }
      try {
        await controlClient.pause();
      } catch {
        pauseFailed = true;
      }
    }
    if (detachFailed || pauseFailed)
      throw new Error(
        `Stage failure; ${detachFailed ? "queue detachment unconfirmed" : "queue detached"}; ${pauseFailed ? "control pause unconfirmed" : "controls paused"}`,
      );
    if (cleanupFailed)
      throw new Error(
        controlsAttempted
          ? "Stage cleanup failed; controls paused and queue detached"
          : "Stage cleanup failed before controls were activated",
      );
    throw failure;
  }
  return receipt;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const receipt = await deployStage(process.env);
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } catch {
    process.stderr.write(
      "Staged activation failed; sensitive output withheld. Queue detachment may require operator verification.\n",
    );
    process.exitCode = 1;
  }
}
