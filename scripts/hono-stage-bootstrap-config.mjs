/** Assemble one fresh stage in memory; caller owns secret delivery and lifecycle. */
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes } from "node:crypto";
import { validateStageRequest } from "./hono-stage-deploy.mjs";
import { stageRoleCredentials } from "./hono-stage-database-role.mjs";
import { checkWorkerAuth } from "./hono-stage-preflight.mjs";
import { checkSecrets } from "./hono-stage-secrets.mjs";

const hex = () => randomBytes(32).toString("hex");
const tokenId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const hosts = {
  api: "hono-stage.quorem.app",
  drain: "runner-hono-stage.quorem.app",
  verifier: "verifier-hono-stage.quorem.app",
  case: "case-hono-stage.quorem.app",
  image: "image-hono-stage.quorem.app",
};

/** Persist this map in the protected bootstrap state before assembling a release. */
export function createStageSecrets() {
  const caseKey = generateKeyPairSync("ed25519"),
    verifierKey = generateKeyPairSync("ed25519");
  return {
    RECOVERY_CONTROL_SECRET: hex(),
    QUOREM_RUNNER_COMMAND_SECRET: hex(),
    QUOREM_RUNNER_DRAIN_SECRET: hex(),
    QUOREM_CASE_SECRET: hex(),
    QUOREM_VERIFICATION_SOURCE_KEY: hex(),
    QUOREM_VERIFICATION_SERVICE_KEY: hex(),
    IMAGE_SERVICE_TOKEN: hex(),
    QUOREM_CASE_OWNER_PUBLIC_KEY_PEM: caseKey.publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
    CASE_OWNER_PRIVATE_KEY: caseKey.privateKey
      .export({ type: "pkcs8", format: "der" })
      .toString("base64"),
    QUOREM_VERIFICATION_SIGNING_KEY_PEM: verifierKey.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    VERIFICATION_PUBLIC_KEY: verifierKey.publicKey
      .export({ type: "spki", format: "der" })
      .toString("base64"),
    MATCH_INVITE_KEY: hex(),
    BETTER_AUTH_SECRET: hex(),
    AUTH_INTERNAL_SECRET: hex(),
    STAGE_RUNTIME_DATABASE_PASSWORD: hex(),
  };
}

export function assembleStageConfig(bootstrap, actions) {
  const required = (name) => {
    const value = actions[name];
    if (typeof value !== "string" || !value) throw new Error(`Missing ${name}`);
    return value;
  };
  let url;
  try {
    url = new URL(bootstrap?.database_url?.value);
  } catch {
    throw new Error("Invalid stage database");
  }
  const tokens = bootstrap?.access_tokens?.value;
  const names = ["runner_api", "verifier_api", "drain", "verifier", "case", "image"];
  if (
    !tokens ||
    names.some(
      (name) =>
        !tokenId.test(tokens[name]?.id ?? "") ||
        !tokens[name]?.client_id ||
        !tokens[name]?.client_secret ||
        /\s/.test(tokens[name].client_id + tokens[name].client_secret),
    )
  )
    throw new Error("Invalid bootstrap Access tokens");
  if (
    new Set(names.map((name) => tokens[name].id)).size !== names.length ||
    new Set(names.map((name) => tokens[name].client_secret)).size !== names.length
  )
    throw new Error("Distinct Access tokens required");
  const account = required("CLOUDFLARE_ACCOUNT_ID"),
    zone = required("CLOUDFLARE_ZONE_ID"),
    sha = required("GITHUB_SHA"),
    cfToken = required("CLOUDFLARE_API_TOKEN");
  for (const name of [
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "TF_STATE_BUCKET",
    "QUOREM_REMOTE_VALIDATION_DATABASE_URL",
  ])
    required(name);
  try {
    const fixture = new URL(actions.QUOREM_REMOTE_VALIDATION_DATABASE_URL);
    if (
      !["postgres:", "postgresql:"].includes(fixture.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(fixture.hostname) ||
      fixture.pathname !== "/quorem_hono_remote_validation_test" ||
      fixture.hash ||
      [...fixture.searchParams.keys()].some((key) =>
        ["host", "hostaddr", "service"].includes(key.toLowerCase()),
      )
    )
      throw new Error();
  } catch {
    throw new Error("Invalid disposable validation database");
  }
  const persisted = bootstrap?.stage_secrets?.value;
  const keys = [
    "RECOVERY_CONTROL_SECRET",
    "QUOREM_RUNNER_COMMAND_SECRET",
    "QUOREM_RUNNER_DRAIN_SECRET",
    "QUOREM_CASE_SECRET",
    "QUOREM_VERIFICATION_SOURCE_KEY",
    "QUOREM_VERIFICATION_SERVICE_KEY",
    "IMAGE_SERVICE_TOKEN",
    "QUOREM_CASE_OWNER_PUBLIC_KEY_PEM",
    "CASE_OWNER_PRIVATE_KEY",
    "QUOREM_VERIFICATION_SIGNING_KEY_PEM",
    "VERIFICATION_PUBLIC_KEY",
    "MATCH_INVITE_KEY",
    "BETTER_AUTH_SECRET",
    "AUTH_INTERNAL_SECRET",
    "STAGE_RUNTIME_DATABASE_PASSWORD",
  ];
  if (
    !persisted ||
    typeof persisted !== "object" ||
    Array.isArray(persisted) ||
    Object.keys(persisted).length !== keys.length ||
    keys.some((key) => typeof persisted[key] !== "string" || !persisted[key])
  )
    throw new Error("Invalid persisted stage secrets");
  const randomKeys = keys.filter(
    (key) =>
      ![
        "QUOREM_CASE_OWNER_PUBLIC_KEY_PEM",
        "CASE_OWNER_PRIVATE_KEY",
        "QUOREM_VERIFICATION_SIGNING_KEY_PEM",
        "VERIFICATION_PUBLIC_KEY",
      ].includes(key),
  );
  const privateValues = [
    ...randomKeys.map((key) => persisted[key]),
    ...names.map((name) => tokens[name].client_secret),
  ];
  if (
    randomKeys.some((key) => !/^[a-f0-9]{64}$/.test(persisted[key])) ||
    new Set(privateValues).size !== privateValues.length ||
    new Set(names.map((name) => tokens[name].client_id)).size !== names.length ||
    !/^[a-f0-9]{32}$/.test(zone)
  )
    throw new Error("Invalid or duplicate staged credentials");
  try {
    const casePrivate = createPrivateKey({
      key: Buffer.from(persisted.CASE_OWNER_PRIVATE_KEY, "base64"),
      format: "der",
      type: "pkcs8",
    });
    const casePublic = createPublicKey(persisted.QUOREM_CASE_OWNER_PUBLIC_KEY_PEM);
    const verifierPrivate = createPrivateKey(persisted.QUOREM_VERIFICATION_SIGNING_KEY_PEM);
    const der = (key) =>
      createPublicKey(key).export({ type: "spki", format: "der" }).toString("base64");
    if (
      casePrivate.asymmetricKeyType !== "ed25519" ||
      casePublic.asymmetricKeyType !== "ed25519" ||
      verifierPrivate.asymmetricKeyType !== "ed25519" ||
      der(casePrivate) !== casePublic.export({ type: "spki", format: "der" }).toString("base64") ||
      der(verifierPrivate) !== persisted.VERIFICATION_PUBLIC_KEY
    )
      throw new Error();
  } catch {
    throw new Error("Invalid persisted signing keys");
  }
  const imageToken = persisted.IMAGE_SERVICE_TOKEN;
  const services = {
    RECOVERY_CONTROL_SECRET: persisted.RECOVERY_CONTROL_SECRET,
    QUOREM_RUNNER_COMMAND_SECRET: persisted.QUOREM_RUNNER_COMMAND_SECRET,
    QUOREM_RUNNER_DRAIN_SECRET: persisted.QUOREM_RUNNER_DRAIN_SECRET,
    QUOREM_CASE_SECRET: persisted.QUOREM_CASE_SECRET,
    QUOREM_VERIFICATION_SOURCE_KEY: persisted.QUOREM_VERIFICATION_SOURCE_KEY,
    QUOREM_VERIFICATION_SERVICE_KEY: persisted.QUOREM_VERIFICATION_SERVICE_KEY,
    IMAGE_SERVICE_TOKEN: imageToken,
    QUOREM_CASE_OWNER_PUBLIC_KEY_PEM: persisted.QUOREM_CASE_OWNER_PUBLIC_KEY_PEM,
    CASE_OWNER_PRIVATE_KEY: persisted.CASE_OWNER_PRIVATE_KEY,
    QUOREM_VERIFICATION_SIGNING_KEY_PEM: persisted.QUOREM_VERIFICATION_SIGNING_KEY_PEM,
    RUNNER_API_ACCESS_CLIENT_ID: tokens.runner_api.client_id,
    RUNNER_API_ACCESS_CLIENT_SECRET: tokens.runner_api.client_secret,
    VERIFIER_API_ACCESS_CLIENT_ID: tokens.verifier_api.client_id,
    VERIFIER_API_ACCESS_CLIENT_SECRET: tokens.verifier_api.client_secret,
    QUOREM_CASE_ACCESS_CLIENT_ID: tokens.case.client_id,
    QUOREM_CASE_ACCESS_CLIENT_SECRET: tokens.case.client_secret,
  };
  const secrets = {
    MATCH_INVITE_KEY: persisted.MATCH_INVITE_KEY,
    BETTER_AUTH_SECRET: persisted.BETTER_AUTH_SECRET,
    AUTH_INTERNAL_SECRET: persisted.AUTH_INTERNAL_SECRET,
    VERIFICATION_ACCESS_CLIENT_ID: tokens.verifier.client_id,
    VERIFICATION_ACCESS_CLIENT_SECRET: tokens.verifier.client_secret,
    EXECUTION_DRAIN_ACCESS_CLIENT_ID: tokens.drain.client_id,
    EXECUTION_DRAIN_ACCESS_CLIENT_SECRET: tokens.drain.client_secret,
    PROFILE_IMAGE_SERVICE_TOKEN: imageToken,
    PROFILE_IMAGE_ACCESS_CLIENT_ID: tokens.image.client_id,
    PROFILE_IMAGE_ACCESS_CLIENT_SECRET: tokens.image.client_secret,
  };
  const vars = {
    APP_ENV: "stage",
    ALLOWED_ORIGINS: `https://${hosts.api}`,
    AUTH_ORIGIN: `https://${hosts.api}`,
    AUTH_MODE: "password",
    AUTH_PASSWORD_PRODUCTION: "true",
    AUTH_LOGIN_ONLY: "true",
    HTTP_MAX_REQUESTS: "16",
    DEADLINE_SHARDS: "2",
    GUEST_CREATION: "true",
    GUEST_ADMISSION: "true",
    GUEST_EXECUTION: "true",
    TRUST_CLOUDFLARE_PEER: "true",
    PROFILE_MEDIA_ENABLED: "true",
    PROFILE_IMAGE_SERVICE_URL: `https://${hosts.image}`,
    PROFILE_IMAGE_ACCESS_MODE: "cloudflare-access",
    VERIFICATION_SERVICE_ORIGIN: `https://${hosts.verifier}`,
    VERIFICATION_ACCESS_MODE: "cloudflare-access",
    VERIFICATION_PUBLIC_KEY: persisted.VERIFICATION_PUBLIC_KEY,
    EXECUTION_DRAIN_URL: `https://${hosts.drain}/internal/drain`,
    EXECUTION_DRAIN_ACCESS_MODE: "cloudflare-access",
  };
  const env = Object.fromEntries(
    [
      "PATH",
      "HOME",
      "USER",
      "TMPDIR",
      "CI",
      "NODE_EXTRA_CA_CERTS",
      "DOCKER_HOST",
      "DOCKER_CONFIG",
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_API_TOKEN",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "TF_STATE_BUCKET",
      "GITHUB_REF",
      "GITHUB_SHA",
      "QUOREM_REMOTE_VALIDATION_DATABASE_URL",
    ]
      .filter((key) => actions[key] !== undefined)
      .map((key) => [key, actions[key]]),
  );
  Object.assign(env, {
    HONO_STAGE_ACTION: "stage",
    HONO_RELEASE_SHA: sha,
    HONO_SERVICES_WORKER_NAME: "quorem-hono-services-stage",
    HONO_STAGE_BROWSER_ORIGIN: `https://${hosts.api}`,
    TF_IN_AUTOMATION: "true",
    TF_VAR_account_id: account,
    TF_VAR_zone_id: zone,
    TF_VAR_cloudflare_api_token: cfToken,
    TF_VAR_worker_name: "quorem-hono-stage",
    TF_VAR_stage_hostname: hosts.api,
    TF_VAR_access_service_token_ids: JSON.stringify([tokens.runner_api.id, tokens.verifier_api.id]),
    TF_VAR_access_token_ids: JSON.stringify({
      drain: tokens.drain.id,
      verifier: tokens.verifier.id,
      case: tokens.case.id,
    }),
    TF_VAR_database_host: url.hostname,
    TF_VAR_database_port: url.port || "5432",
    TF_VAR_database_name: "quorem_hono_stage",
    TF_VAR_database_password: persisted.STAGE_RUNTIME_DATABASE_PASSWORD,
    TF_VAR_database_connection_limit: "5",
    TF_VAR_enable_queue_consumer: "false",
    TF_VAR_hostnames: JSON.stringify({
      drain: hosts.drain,
      verifier: hosts.verifier,
      case: hosts.case,
    }),
    TF_VAR_profile_media_enabled: "true",
    TF_VAR_image_hostname: hosts.image,
    TF_VAR_image_access_service_token_id: tokens.image.id,
    TF_VAR_command_origin: `https://${hosts.api}`,
    TF_VAR_source_origin: `https://${hosts.api}`,
    TF_VAR_case_namespace_id: "0".repeat(64),
    TF_VAR_case_diagnostics: "true",
    TF_VAR_release_generation: "1",
    TF_VAR_service_secrets: JSON.stringify(services),
    HONO_WORKER_SECRETS_JSON: JSON.stringify(secrets),
    HONO_STAGE_PUBLIC_JSON: JSON.stringify({ stageZone: "quorem.app", vars }),
    HONO_STAGE_DATABASE_URL: url.href,
  });
  validateStageRequest(env, { requireImages: false });
  stageRoleCredentials(env);
  checkWorkerAuth(vars, secrets, true);
  checkSecrets({
    ...secrets,
    RUNNER_PEERS: JSON.stringify([
      { secret: services.QUOREM_RUNNER_COMMAND_SECRET, scope: "preflight-only", resumable: true },
    ]),
    VERIFICATION_SOURCE_CREDENTIAL: services.QUOREM_VERIFICATION_SOURCE_KEY,
    VERIFICATION_SERVICE_CREDENTIAL: services.QUOREM_VERIFICATION_SERVICE_KEY,
    EXECUTION_DRAIN_SECRET: services.QUOREM_RUNNER_DRAIN_SECRET,
    CLOUDFLARE_ACCESS_CLIENT_ID: services.RUNNER_API_ACCESS_CLIENT_ID,
    CLOUDFLARE_ACCESS_CLIENT_SECRET: services.RUNNER_API_ACCESS_CLIENT_SECRET,
  });
  return env;
}
