import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  assertRunnerResult,
  assertSelectedReport,
  remoteFailureReason,
} from "./hono-remote-validation.mjs";
const name =
  "admission through TypeScript runner runs an admitted job through separate runner and verifier executables";
void test("accepts only the selected passing test, independent of unrelated skipped count", () => {
  const report = (tests, passed = 1, failed = 0) =>
    JSON.stringify({
      numPassedTests: passed,
      numFailedTests: failed,
      testResults: [{ assertionResults: tests }],
    });
  const target = { fullName: name, status: "passed" };
  assert.doesNotThrow(() =>
    assertSelectedReport(report([target, { fullName: "other", status: "skipped" }])),
  );
  assert.doesNotThrow(() => assertSelectedReport(report([target])));
  assert.throws(() => assertSelectedReport(report([{ fullName: "other", status: "passed" }])));
  assert.throws(() => assertSelectedReport(report([target, target], 2)));
  assert.throws(
    () =>
      assertSelectedReport(
        report(
          [{ ...target, status: "failed", failureMessages: ["credential-sentinel-secret"] }],
          0,
          1,
        ),
      ),
    (error) => !String(error).includes("credential-sentinel-secret"),
  );
});
void test("configuration failures suppress supplied credential values", () => {
  const sentinel = "credential-sentinel-secret-0123456789";
  const child = spawnSync(process.execPath, ["scripts/hono-remote-validation.mjs"], {
    encoding: "utf8",
    env: {
      ...process.env,
      QUOREM_REMOTE_VALIDATION_DATABASE_URL: "postgres://127.0.0.1/production",
      QUOREM_CASE_SECRET: sentinel,
    },
  });
  assert.notEqual(child.status, 0);
  assert.equal((child.stdout + child.stderr).includes(sentinel), false);
});
void test("runner and malformed provider output never escape in errors", () => {
  const sentinel = "provider-credential-sentinel-0123456789";
  for (const result of [
    { status: 1, stdout: sentinel, stderr: sentinel },
    { status: 0, stdout: sentinel, stderr: sentinel },
  ])
    assert.throws(
      () => assertRunnerResult(result),
      (error) => !String(error).includes(sentinel),
    );
});

void test("remote assertion diagnostics retain cause while scrubbing credentials", () => {
  const secret = "fixture-sensitive-value-123456789";
  const result = {
    stdout: JSON.stringify({
      testResults: [
        {
          assertionResults: [
            {
              failureMessages: [
                `Expected accepted, received infrastructure_error; ${secret}; https://example.com/private`,
              ],
            },
          ],
        },
      ],
    }),
  };
  const reason = remoteFailureReason(result, [secret]);
  assert.match(reason, /Expected accepted, received/);
  assert.doesNotMatch(reason, /fixture-sensitive|example.com/);
});
