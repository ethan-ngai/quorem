/** Build an isolated Wrangler configuration; credentials belong in Worker secrets. */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicKey } from "node:crypto";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const allowed = new Set([
  "APP_ENV",
  "ALLOWED_ORIGINS",
  "AUTH_ORIGIN",
  "AUTH_MODE",
  "AUTH_LOGIN_ONLY",
  "AUTH_PASSWORD_PRODUCTION",
  "AUTH_PASSKEYS",
  "AUTH_EMAIL_DRIVER",
  "AUTH_EMAIL_FROM",
  "AUTH_EMAIL_CLOUDFLARE_ACCOUNT_ID",
  "COGNITO_CLIENT_ID",
  "COGNITO_DOMAIN",
  "COGNITO_REGION",
  "COGNITO_USERPOOL_ID",
  "GOOGLE_CLIENT_ID",
  "APPLE_CLIENT_ID",
  "GITHUB_CLIENT_ID",
  "PROFILE_MEDIA_ENABLED",
  "PROFILE_IMAGE_SERVICE_URL",
  "PROFILE_IMAGE_ACCESS_MODE",
  "HTTP_MAX_REQUESTS",
  "DEADLINE_SHARDS",
  "GUEST_CREATION",
  "GUEST_ADMISSION",
  "GUEST_EXECUTION",
  "TRUST_CLOUDFLARE_PEER",
  "SOCKET_HEARTBEAT_MS",
  "VERIFICATION_SERVICE_ORIGIN",
  "VERIFICATION_ACCESS_MODE",
  "VERIFICATION_PUBLIC_KEY",
  "EXECUTION_DRAIN_URL",
  "EXECUTION_DRAIN_ACCESS_MODE",
]);
export function stageConfig(input, outputs, output) {
  const { stageZone, vars } = input;
  const profileBucket = outputs?.profile_bucket_name?.value;
  const workerName = outputs?.worker_name?.value;
  const hyperdriveId = outputs?.hyperdrive_id?.value;
  const queueName = outputs?.queue_name?.value;
  const stageHostname = outputs?.stage_hostname?.value;
  const accessId = outputs?.internal_access_application_id?.value;
  const drainOrigin = outputs?.services?.origins?.value?.DRAIN_ORIGIN;
  const drainAccessId = outputs?.services?.drain_access_application_id?.value;
  if (
    !/^[a-z][a-z0-9-]*-hono-stage$/.test(workerName) ||
    !/^[0-9a-f]{32}$/.test(hyperdriveId) ||
    queueName !== `${workerName}-execution` ||
    typeof accessId !== "string" ||
    !/^[0-9a-f-]{32,36}$/.test(accessId) ||
    typeof drainAccessId !== "string" ||
    !/^[0-9a-f-]{32,36}$/.test(drainAccessId) ||
    drainAccessId === accessId
  )
    throw new Error("Invalid isolated stage resources");
  if (
    !vars ||
    typeof vars !== "object" ||
    Array.isArray(vars) ||
    Object.entries(vars).some(
      ([key, value]) =>
        !allowed.has(key) || typeof value !== "string" || !value || value.trim() !== value,
    )
  )
    throw new Error("Invalid public runtime variables");
  for (const key of [
    "APP_ENV",
    "ALLOWED_ORIGINS",
    "AUTH_ORIGIN",
    "AUTH_MODE",
    "HTTP_MAX_REQUESTS",
    "DEADLINE_SHARDS",
    "VERIFICATION_SERVICE_ORIGIN",
    "VERIFICATION_ACCESS_MODE",
    "VERIFICATION_PUBLIC_KEY",
    "EXECUTION_DRAIN_URL",
    "EXECUTION_DRAIN_ACCESS_MODE",
  ])
    if (!vars[key]) throw new Error(`Missing ${key}`);
  if (!["password", "cognito"].includes(vars.AUTH_MODE)) throw new Error("Invalid AUTH_MODE");
  if (vars.APP_ENV === "local") throw new Error("Staged Worker must not use local identity");
  if (vars.VERIFICATION_ACCESS_MODE !== "cloudflare-access")
    throw new Error("Staged verifier requires Access service authentication");
  if (vars.EXECUTION_DRAIN_ACCESS_MODE !== "cloudflare-access")
    throw new Error("Staged drain requires Access service authentication");
  const host = new URL(vars.AUTH_ORIGIN).hostname;
  if (
    typeof stageZone !== "string" ||
    stageHostname !== host ||
    !/^[a-z0-9.-]+$/.test(stageZone) ||
    !host.endsWith(`.${stageZone}`) ||
    !/(^|-)stag(e|ing)(-|$)/.test(host.split(".")[0])
  )
    throw new Error("A distinct staged hostname and zone are required");
  const bounded = (value, min, max) =>
    /^[1-9]\d*$/.test(value) &&
    Number.isSafeInteger(Number(value)) &&
    Number(value) >= min &&
    Number(value) <= max;
  if (
    !bounded(vars.HTTP_MAX_REQUESTS, 1, 1024) ||
    !bounded(vars.DEADLINE_SHARDS, 1, 256) ||
    (vars.SOCKET_HEARTBEAT_MS !== undefined && !bounded(vars.SOCKET_HEARTBEAT_MS, 1000, 120000))
  )
    throw new Error("Invalid runtime capacity");
  try {
    const bytes = Buffer.from(vars.VERIFICATION_PUBLIC_KEY, "base64");
    if (
      bytes.toString("base64") !== vars.VERIFICATION_PUBLIC_KEY ||
      createPublicKey({ key: bytes, format: "der", type: "spki" }).asymmetricKeyType !== "ed25519"
    )
      throw new Error();
  } catch {
    throw new Error("Invalid verifier public key");
  }
  for (const key of ["AUTH_ORIGIN", "VERIFICATION_SERVICE_ORIGIN", "EXECUTION_DRAIN_URL"]) {
    const u = new URL(vars[key]);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      (key === "EXECUTION_DRAIN_URL" ? u.pathname !== "/internal/drain" : u.pathname !== "/")
    )
      throw new Error(`Invalid ${key}`);
  }
  if (
    typeof drainOrigin !== "string" ||
    vars.EXECUTION_DRAIN_URL !== `${drainOrigin}/internal/drain`
  )
    throw new Error("Drain must match the protected Terraform hostname");
  if (
    vars.ALLOWED_ORIGINS.split(",").some((value) => {
      try {
        const u = new URL(value);
        return u.protocol !== "https:" || u.origin !== value || u.username || u.password;
      } catch {
        return true;
      }
    })
  )
    throw new Error("Invalid ALLOWED_ORIGINS");
  if (![undefined, "true", "false"].includes(vars.PROFILE_MEDIA_ENABLED))
    throw new Error("Invalid profile media flag");
  if (input.profileBucket !== undefined && input.profileBucket !== profileBucket)
    throw new Error("Profile bucket must match Terraform output");
  if (vars.PROFILE_MEDIA_ENABLED !== "true" && profileBucket)
    throw new Error("Unexpected profile bucket");
  if (
    vars.PROFILE_MEDIA_ENABLED === "true" &&
    (!profileBucket ||
      !vars.PROFILE_IMAGE_SERVICE_URL ||
      vars.PROFILE_IMAGE_ACCESS_MODE !== "cloudflare-access")
  )
    throw new Error("Profile media requires its bucket and image service");
  if (profileBucket && !/^[a-z0-9][a-z0-9-]{1,62}$/.test(profileBucket))
    throw new Error("Invalid profile bucket");
  return {
    name: workerName,
    main: relative(dirname(resolve(output)), resolve(root, "apps/api/src/runtime/worker.ts")),
    compatibility_date: "2026-10-23",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: false,
    preview_urls: false,
    routes: ["/v1/*", "/api/auth/*", "/health", "/internal/*"].map((path) => ({
      pattern: `${host}${path}`,
      zone_name: stageZone,
    })),
    vars: { ...vars, EXECUTION_WAKE_PROVIDER: "cloudflare-binding" },
    hyperdrive: [{ binding: "DB", id: hyperdriveId }],
    queues: { producers: [{ binding: "EXECUTION_QUEUE", queue: queueName }] },
    durable_objects: {
      bindings: [
        { name: "SOCKETS", class_name: "BrowserSockets" },
        { name: "DEADLINES", class_name: "DeadlineCoordinator" },
        { name: "EXECUTION_RECOVERY", class_name: "ExecutionRecovery" },
      ],
    },
    migrations: [
      {
        tag: "v1",
        new_sqlite_classes: ["BrowserSockets", "DeadlineCoordinator", "ExecutionRecovery"],
      },
    ],
    triggers: { crons: ["* * * * *"] },
    ...(profileBucket
      ? { r2_buckets: [{ binding: "PROFILE_BUCKET", bucket_name: profileBucket }] }
      : {}),
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [input, outputs, output] = process.argv.slice(2);
  if (!input || !outputs || !output)
    throw new Error(
      "Usage: node scripts/hono-stage-config.mjs <public-input.json> <terraform-outputs.json> <wrangler.json>",
    );
  const config = stageConfig(
    JSON.parse(await readFile(input, "utf8")),
    JSON.parse(await readFile(outputs, "utf8")),
    output,
  );
  await writeFile(output, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}
