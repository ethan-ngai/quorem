import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reusableNativeImages } from "./hono-native-image-reuse.mjs";

const prior = "a".repeat(40),
  account = "c".repeat(32);
const env = {
  GITHUB_SHA: "b".repeat(40),
  CLOUDFLARE_ACCOUNT_ID: account,
  CLOUDFLARE_API_TOKEN: "fixture-only",
};
const images = Object.fromEntries(
  ["java", "ocaml", "postgresql", "python", "typescript"].map((role) => [
    role,
    `registry.cloudflare.com/${account}/${role}@sha256:${"d".repeat(64)}`,
  ]),
);
function provider({ release = prior, versions, refs = images } = {}) {
  return async (url) =>
    Response.json({
      success: true,
      result: url.endsWith("/deployments")
        ? {
            deployments: [
              {
                versions: versions ?? [
                  { version_id: "12345678-1234-1234-1234-123456789abc", percentage: 100 },
                ],
              },
            ],
          }
        : {
            resources: {
              bindings: [{ name: "SERVICES_RELEASE", type: "plain_text", text: release }],
              script_runtime: { containers: [{ class_name: "CaseSandbox", images: refs }] },
            },
          },
    });
}

void test("controller changes reuse artifacts; Docker input changes require new builds", async () => {
  const directory = await mkdtemp(join(tmpdir(), "quorem-native-images-"));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const run = (_command, args) => git(...args);
  try {
    git("init", "-q");
    git("config", "commit.gpgsign", "false");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.test");
    await mkdir(join(directory, "apps/runner/python"), { recursive: true });
    await mkdir(join(directory, "deploy"));
    await writeFile(join(directory, "apps/runner/python/harness.py"), "native-v1");
    await writeFile(join(directory, "deploy/case-sandbox.js"), "controller-v1");
    git("add", ".");
    git("commit", "-qm", "fixture");
    const source = git("rev-parse", "HEAD");
    await writeFile(join(directory, "deploy/case-sandbox.js"), "controller-v2");
    git("commit", "-qam", "controller");
    const current = { ...env, GITHUB_SHA: git("rev-parse", "HEAD") };
    assert.deepEqual(
      await reusableNativeImages(current, source, provider({ release: source }), run),
      images,
    );
    await writeFile(join(directory, "apps/runner/python/harness.py"), "native-v2");
    git("commit", "-qam", "native");
    current.GITHUB_SHA = git("rev-parse", "HEAD");
    assert.equal(
      await reusableNativeImages(
        current,
        source,
        () => {
          throw new Error("No provider read for changed inputs");
        },
        run,
      ),
      undefined,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

void test("reuse rejects ambiguous deployment, mismatched release and unpinned artifacts", async () => {
  for (const fixture of [
    { release: "e".repeat(40) },
    { versions: [{ version_id: "12345678-1234-1234-1234-123456789abc", percentage: 50 }] },
    { refs: { ...images, python: "docker.io/python:latest" } },
    {
      refs: {
        ...images,
        python: `registry.cloudflare.com/${"e".repeat(32)}/python@sha256:${"d".repeat(64)}`,
      },
    },
    { refs: { python: images.python } },
    { refs: { ...images, extra: images.python } },
  ])
    await assert.rejects(reusableNativeImages(env, prior, provider(fixture), () => ""));
});

void test("provider errors and oversized metadata fail without exposing response details", async () => {
  await assert.rejects(
    reusableNativeImages(
      env,
      prior,
      async () => new Response("private-provider-detail", { status: 503 }),
      () => "",
    ),
    /^Error: Native image metadata unavailable$/,
  );
  await assert.rejects(
    reusableNativeImages(
      env,
      prior,
      async () => new Response(" ".repeat(1048577)),
      () => "",
    ),
    /exceeded its bound/,
  );
});
