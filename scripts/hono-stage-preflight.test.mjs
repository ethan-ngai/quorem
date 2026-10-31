import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkStagePreflight, validatedWorkerSecrets } from "./hono-stage-preflight.mjs";
const input = () =>
  JSON.parse(readFileSync(new URL("../deploy/hono/stage.fixture.json", import.meta.url)));
const outputs = () =>
  JSON.parse(
    readFileSync(new URL("../deploy/hono/terraform-outputs.fixture.json", import.meta.url)),
  );
const secrets = () => ({
  MATCH_INVITE_KEY: "ab".repeat(32),
  BETTER_AUTH_SECRET: "a".repeat(32),
  AUTH_INTERNAL_SECRET: "fixture-internal",
  RUNNER_PEERS: JSON.stringify([{ secret: "r".repeat(32), scope: "fixture", resumable: true }]),
  VERIFICATION_SOURCE_CREDENTIAL: "a".repeat(64),
  VERIFICATION_SERVICE_CREDENTIAL: "b".repeat(64),
  EXECUTION_DRAIN_SECRET: "d".repeat(32),
  CLOUDFLARE_ACCESS_CLIENT_ID: "fixture-id",
  CLOUDFLARE_ACCESS_CLIENT_SECRET: "fixture-secret",
  VERIFICATION_ACCESS_CLIENT_ID: "verifier-id",
  VERIFICATION_ACCESS_CLIENT_SECRET: "verifier-secret",
  EXECUTION_DRAIN_ACCESS_CLIENT_ID: "drain-id",
  EXECUTION_DRAIN_ACCESS_CLIENT_SECRET: "drain-secret",
});
const login = () => {
  const i = input();
  Object.assign(i.vars, {
    AUTH_MODE: "password",
    AUTH_PASSWORD_PRODUCTION: "true",
    AUTH_LOGIN_ONLY: "true",
  });
  return i;
};
void test("constructs the real Worker auth runtime for explicit login-only and Cognito", () => {
  assert.doesNotThrow(() => checkStagePreflight(login(), outputs(), secrets()));
  const i = input();
  delete i.vars.AUTH_LOGIN_ONLY;
  Object.assign(i.vars, {
    AUTH_MODE: "cognito",
    COGNITO_CLIENT_ID: "id",
    COGNITO_DOMAIN: "auth.example",
    COGNITO_REGION: "region",
    COGNITO_USERPOOL_ID: "pool",
  });
  assert.doesNotThrow(() =>
    checkStagePreflight(i, outputs(), { ...secrets(), COGNITO_CLIENT_SECRET: "secret" }),
  );
  assert.throws(() => checkStagePreflight(i, outputs(), secrets()), /COGNITO_CLIENT_SECRET/);
});
void test("rejects missing mode, unsafe password settings and partial provider credentials", () => {
  const missing = input();
  delete missing.vars.AUTH_MODE;
  assert.throws(() => checkStagePreflight(missing, outputs(), secrets()), /AUTH_MODE/);
  const unsafe = input();
  delete unsafe.vars.AUTH_PASSWORD_PRODUCTION;
  assert.throws(() => checkStagePreflight(unsafe, outputs(), secrets()), /Production password/);
  assert.throws(
    () => checkStagePreflight(login(), outputs(), { ...secrets(), MATCH_INVITE_KEY: "bad" }),
    /runtime key/,
  );
  const social = login();
  social.vars.GOOGLE_CLIENT_ID = "id";
  assert.throws(() => checkStagePreflight(social, outputs(), secrets()), /GOOGLE/);
});
void test("uses actual Worker restrictions for mail, encryption key, and profile service", () => {
  const mail = input();
  delete mail.vars.AUTH_LOGIN_ONLY;
  Object.assign(mail.vars, {
    AUTH_MODE: "password",
    AUTH_PASSWORD_PRODUCTION: "true",
    AUTH_EMAIL_DRIVER: "cloudflare",
    AUTH_EMAIL_FROM: "fixture@example.com",
    AUTH_EMAIL_CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  });
  const mailSecrets = {
    ...secrets(),
    AUTH_EMAIL_CLOUDFLARE_API_TOKEN: "fixture",
    AUTH_MAIL_INTENT_KEY: "aa".repeat(32),
  };
  assert.doesNotThrow(() => checkStagePreflight(mail, outputs(), mailSecrets));
  assert.throws(
    () => checkStagePreflight(mail, outputs(), { ...mailSecrets, AUTH_MAIL_INTENT_KEY: "bad" }),
    /AUTH_MAIL_INTENT_KEY/,
  );
  const smtp = login();
  smtp.vars.AUTH_LOGIN_ONLY = "false";
  smtp.vars.AUTH_EMAIL_DRIVER = "smtp";
  smtp.vars.AUTH_EMAIL_FROM = "fixture@example.com";
  assert.throws(
    () =>
      checkStagePreflight(smtp, outputs(), {
        ...secrets(),
        SMTP_HOST: "mail.example.com",
        SMTP_USERNAME: "fixture",
        SMTP_PASSWORD: "fixture",
      }),
    /Worker mail requires/,
  );
  const profile = login();
  profile.profileBucket = "fixture-bucket";
  Object.assign(profile.vars, {
    PROFILE_MEDIA_ENABLED: "true",
    PROFILE_IMAGE_SERVICE_URL: "https://images.example",
  });
  assert.throws(() => checkStagePreflight(profile, outputs(), secrets()), /image service/);
  assert.doesNotThrow(() =>
    checkStagePreflight(profile, outputs(), {
      ...secrets(),
      PROFILE_IMAGE_SERVICE_TOKEN: "x".repeat(32),
    }),
  );
});

void test("CLI failure never prints a supplied secret", async () => {
  const { spawnSync } = await import("node:child_process");
  const marker = "DO_NOT_PRINT_SECRET_FIXTURE";
  const result = spawnSync(
    process.execPath,
    [
      "scripts/hono-stage-preflight.mjs",
      "deploy/hono/stage.fixture.json",
      "deploy/hono/terraform-outputs.fixture.json",
    ],
    { encoding: "utf8", env: { ...process.env, BETTER_AUTH_SECRET: marker } },
  );
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(marker));
  assert.match(result.stderr, /Stage preflight failed/);
});

void test("secret upload projection omits private signing and host-only credentials", () => {
  const projected = validatedWorkerSecrets(login(), outputs(), {
    ...secrets(),
    CASE_OWNER_PRIVATE_KEY: "fixture-private-key",
    QUOREM_VERIFICATION_SIGNING_KEY_PEM: "fixture-signing-key",
    QUOREM_CASE_SECRET: "fixture-case-secret",
  });
  assert.equal(projected.MATCH_INVITE_KEY, secrets().MATCH_INVITE_KEY);
  assert.equal(
    projected.VERIFICATION_ACCESS_CLIENT_SECRET,
    secrets().VERIFICATION_ACCESS_CLIENT_SECRET,
  );
  for (const key of [
    "CASE_OWNER_PRIVATE_KEY",
    "QUOREM_VERIFICATION_SIGNING_KEY_PEM",
    "QUOREM_CASE_SECRET",
    "CLOUDFLARE_ACCESS_CLIENT_ID",
    "CLOUDFLARE_ACCESS_CLIENT_SECRET",
  ])
    assert.equal(projected[key], undefined);
});
