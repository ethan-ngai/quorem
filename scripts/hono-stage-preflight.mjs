/** Validate the staged Worker with its actual auth composition; no network calls. */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { workerRuntime } from "../apps/auth/src/worker.ts";
import { keyBytes, privateConfig, flag } from "../apps/api/src/runtime/composition/config.ts";
import { stageConfig } from "./hono-stage-config.mjs";
import { checkSecrets } from "./hono-stage-secrets.mjs";

const secretNames = [
  "MATCH_INVITE_KEY",
  "BETTER_AUTH_SECRET",
  "AUTH_INTERNAL_SECRET",
  "AUTH_MAIL_INTENT_KEY",
  "AUTH_EMAIL_CLOUDFLARE_API_TOKEN",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USERNAME",
  "SMTP_PASSWORD",
  "AUTH_EMAIL_SES_REGION",
  "COGNITO_CLIENT_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "APPLE_CLIENT_SECRET",
  "GITHUB_CLIENT_SECRET",
  "PROFILE_IMAGE_SERVICE_TOKEN",
  "RUNNER_PEERS",
  "VERIFICATION_SOURCE_CREDENTIAL",
  "VERIFICATION_SERVICE_CREDENTIAL",
  "EXECUTION_DRAIN_SECRET",
  "CLOUDFLARE_ACCESS_CLIENT_ID",
  "CLOUDFLARE_ACCESS_CLIENT_SECRET",
  "VERIFICATION_ACCESS_CLIENT_ID",
  "VERIFICATION_ACCESS_CLIENT_SECRET",
  "EXECUTION_DRAIN_ACCESS_CLIENT_ID",
  "EXECUTION_DRAIN_ACCESS_CLIENT_SECRET",
];
export function checkStagePreflight(input, outputs, secrets) {
  const config = stageConfig(input, outputs, "/tmp/quorem-stage-preflight.json");
  checkSecrets(secrets);
  const workerSecrets = Object.fromEntries(
    secretNames.filter((name) => secrets[name] !== undefined).map((name) => [name, secrets[name]]),
  );
  const merged = { ...workerSecrets, ...config.vars };
  keyBytes(merged.MATCH_INVITE_KEY);
  privateConfig(merged);
  for (const name of [
    "GUEST_CREATION",
    "GUEST_ADMISSION",
    "GUEST_EXECUTION",
    "TRUST_CLOUDFLARE_PEER",
  ])
    flag(merged[name]);
  workerRuntime({
    ...merged,
    DB: { connectionString: "postgres://fixture:fixture@127.0.0.1:1/fixture" },
    ...(config.r2_buckets ? { PROFILE_BUCKET: {} } : {}),
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [publicFile, outputsFile] = process.argv.slice(2);
    if (!publicFile || !outputsFile)
      throw new Error("Missing public configuration or Terraform outputs");
    checkStagePreflight(
      JSON.parse(await readFile(publicFile, "utf8")),
      JSON.parse(await readFile(outputsFile, "utf8")),
      process.env,
    );
  } catch {
    process.stderr.write("Stage preflight failed; check runtime configuration and credentials.\n");
    process.exitCode = 1;
  }
}
