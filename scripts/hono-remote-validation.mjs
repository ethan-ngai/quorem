/** Hosted case acceptance; uses only a named disposable local database. */
import { readFile } from "node:fs/promises";
import { createPublicKey } from "node:crypto";
import { spawnSync } from "node:child_process";

function fail(message) {
  throw new Error(message);
}
function required(name) {
  const value = process.env[name];
  if (!value || value.trim() !== value) fail(`Missing or invalid ${name}`);
  return value;
}
export function assertSelectedReport(raw) {
  const json = JSON.parse(raw);
  const tests = json.testResults?.flatMap((file) => file.assertionResults ?? []) ?? [];
  const target = tests.filter(
    (test) =>
      test.fullName ===
      "admission through TypeScript runner runs an admitted job through separate runner and verifier executables",
  );
  if (
    json.numPassedTests !== 1 ||
    json.numFailedTests !== 0 ||
    target.length !== 1 ||
    target[0].status !== "passed" ||
    tests.some((test) => !["passed", "skipped", "pending", "todo"].includes(test.status))
  )
    throw new Error("Remote test selection mismatch");
}
export function assertRunnerResult(result) {
  try {
    if (result.error || result.status !== 0) fail("Remote execution validation failed");
    assertSelectedReport(result.stdout);
  } catch {
    throw new Error("Remote execution validation failed");
  }
}
async function main() {
  try {
    const database = required("QUOREM_REMOTE_VALIDATION_DATABASE_URL");
    const db = new URL(database);
    if (
      !["postgres:", "postgresql:"].includes(db.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(db.hostname) ||
      db.pathname !== "/quorem_hono_remote_validation_test" ||
      db.hash ||
      [...db.searchParams.keys()].some((k) =>
        ["host", "hostaddr", "service"].includes(k.toLowerCase()),
      )
    )
      fail("Invalid disposable database");
    const origin = new URL(required("QUOREM_CASE_ORIGIN"));
    if (
      origin.protocol !== "https:" ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    )
      fail("Invalid case origin");
    const secret = required("QUOREM_CASE_SECRET");
    if (
      new TextEncoder().encode(secret).length < 32 ||
      /\s/.test(secret) ||
      ["fixture-command-secret-123456789012345", "fixture-drain-secret-12345678901234567"].includes(
        secret,
      )
    )
      fail("Invalid case credential");
    if (!/^[a-f0-9]{64}$/.test(required("QUOREM_CASE_NAMESPACE_ID"))) fail("Invalid namespace");
    const keyFile = required("QUOREM_CASE_OWNER_PUBLIC_KEY_FILE");
    if (
      !keyFile.startsWith("/") ||
      createPublicKey(await readFile(keyFile)).asymmetricKeyType !== "ed25519"
    )
      fail("Invalid owner key");
    const id = process.env.QUOREM_CASE_ACCESS_CLIENT_ID,
      access = process.env.QUOREM_CASE_ACCESS_CLIENT_SECRET;
    if (
      (id === undefined) !== (access === undefined) ||
      (id !== undefined &&
        (!id ||
          !access ||
          id.length > 256 ||
          access.length > 256 ||
          /\s/.test(id + access) ||
          id === access ||
          [
            secret,
            "fixture-command-secret-123456789012345",
            "fixture-drain-secret-12345678901234567",
          ].some((x) => x === id || x === access)))
    )
      fail("Invalid case ingress credentials");
    const publicKey = await crypto.subtle.importKey(
      "spki",
      createPublicKey(await readFile(keyFile)).export({ type: "spki", format: "der" }),
      "Ed25519",
      false,
      ["verify"],
    );
    const { verifyCaseProbe } = await import("../deploy/case-proof.js");
    const { accessFetch } = await import("../packages/execution/src/transport/access.ts");
    const send =
      accessFetch(origin.origin, id && access ? { id, secret: access } : undefined) ?? fetch;
    const nonce = crypto.randomUUID();
    const response = await send(new URL("/internal/case/namespace", origin), {
      headers: { authorization: `Bearer ${secret}`, "x-quorem-owner-nonce": nonce },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    await verifyCaseProbe(response, {
      publicKey,
      kind: "namespace",
      scope: "",
      attempt: "namespace",
      nonce,
      expectedNamespace: process.env.QUOREM_CASE_NAMESPACE_ID,
    });
    const result = spawnSync(
      "vp",
      [
        "-C",
        "apps/api",
        "exec",
        "vitest",
        "run",
        "--config",
        "src/adapters/postgres/judging/admission/vitest.runner.config.ts",
        "src/adapters/postgres/judging/admission/runner.integration.test.ts",
        "-t",
        "runs an admitted job through separate runner and verifier executables",
      ],
      {
        env: {
          ...process.env,
          QUOREM_REMOTE_VALIDATION: "true",
          QUOREM_REPORT_JSON_STDOUT: "true",
          QUOREM_ENGINE_TEST_DATABASE_URL: database,
        },
        stdio: "pipe",
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    assertRunnerResult(result);
    console.log("Remote execution validation passed");
  } catch {
    console.error("Remote validation configuration or execution failed");
    process.exitCode = 1;
  }
}
if (import.meta.main) await main();
