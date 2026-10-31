import { test } from "node:test";
import assert from "node:assert/strict";
import { publishImages } from "./hono-stage-deploy-images.mjs";
const env = () => ({
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  HONO_RELEASE_SHA: "b".repeat(40),
  GITHUB_SHA: "b".repeat(40),
  GITHUB_REF: "refs/heads/feat/hono-migration",
});
void test("builds and pins every pushed image to its matching registry digest", () => {
  const calls = [];
  const run = (cmd, args, options) => {
    assert.equal(options.env.SERVICE_PRIVATE_SECRET, undefined);
    calls.push([cmd, args]);
    if (cmd === "docker" && args[0] === "image")
      return {
        status: 0,
        stdout: JSON.stringify([`${args.at(-1).replace(/:[^:]+$/, "")}@sha256:${"c".repeat(64)}`]),
      };
    return { status: 0, stdout: "" };
  };
  const images = publishImages({ ...env(), SERVICE_PRIVATE_SECRET: "fixture-private" }, run);
  assert.deepEqual(Object.keys(images), [
    "runner",
    "verifier",
    "python",
    "java",
    "typescript",
    "ocaml",
    "postgresql",
  ]);
  assert.equal(calls.filter(([cmd, args]) => cmd === "vp" && args.includes("push")).length, 7);
  assert.ok(Object.values(images).every((v) => v.endsWith(`@sha256:${"c".repeat(64)}`)));
});
void test("rejects wrong SHA and unverifiable or ambiguous remote digest without leaking output", () => {
  assert.throws(() =>
    publishImages({ ...env(), GITHUB_SHA: "c".repeat(40) }, () => {
      throw new Error("must not execute");
    }),
  );
  assert.throws(
    () =>
      publishImages(env(), (cmd, args) => ({
        status: 0,
        stdout: cmd === "docker" && args[0] === "image" ? "[]" : "",
      })),
    /digest/,
  );
  assert.throws(
    () => publishImages(env(), () => ({ status: 1, stderr: "private-fixture-secret" })),
    (error) => !String(error).includes("private-fixture-secret"),
  );
});

void test("builds and resolves the optional image processor only when enabled", () => {
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === "docker" && args[0] === "image")
      return {
        status: 0,
        stdout: JSON.stringify([`${args.at(-1).replace(/:[^:]+$/, "")}@sha256:${"c".repeat(64)}`]),
      };
    return { status: 0, stdout: "" };
  };
  const images = publishImages({ ...env(), TF_VAR_profile_media_enabled: "true" }, run);
  assert.ok(images.image);
  assert.ok(
    calls.some(
      ([cmd, args]) => cmd === "docker" && args.includes("deploy/hono/services/Dockerfile.image"),
    ),
  );
});
