import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { verifyMigrationArtifact } from "./hono-migration-artifact.mjs";
const root = "repos/ethan-ngai/quorem",
  sha = "a".repeat(40),
  runId = "1234567";
const object = (path, bytes) => ({
  type: "file",
  path,
  size: bytes.length,
  encoding: "base64",
  content: bytes.toString("base64"),
  sha: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),
});
async function fixture() {
  const run = {
    id: 1234567,
    path: ".github/workflows/deploy.yaml",
    name: "Deploy production",
    status: "completed",
    conclusion: "success",
    head_branch: "main",
    event: "push",
    head_sha: sha,
    run_attempt: 2,
    repository: { full_name: "ethan-ngai/quorem" },
    head_repository: { full_name: "ethan-ngai/quorem" },
  };
  const job = {
    name: "deploy",
    run_id: 1234567,
    status: "completed",
    conclusion: "success",
    steps: [
      { name: "Run actions/checkout@abcd", number: 1, status: "completed", conclusion: "success" },
      {
        name: "Migrate and bootstrap operator",
        number: 2,
        status: "completed",
        conclusion: "success",
      },
    ],
  };
  const paths = [
    ".github/workflows/deploy.yaml",
    "apps/api/cmd/provision/main.go",
    "apps/api/internal/adapters/postgres/store.go",
    "apps/auth/src/migrations.ts",
    "apps/auth/src/migrate.ts",
    "apps/auth/package.json",
    "apps/api/migrations/007_schema.sql",
    "apps/auth/migrations/001_schema.sql",
  ];
  const files = new Map(await Promise.all(paths.map(async (path) => [path, await readFile(path)])));
  const request = async (path) => {
    if (path === `${root}/actions/runs/${runId}`) return structuredClone(run);
    if (path === `${root}/actions/runs/${runId}/attempts/2/jobs?per_page=100&page=1`)
      return { total_count: 1, jobs: [structuredClone(job)] };
    const prefix = `${root}/contents/`,
      suffix = `?ref=${sha}`;
    assert.ok(path.startsWith(prefix) && path.endsWith(suffix));
    const name = path.slice(prefix.length, -suffix.length),
      bytes = files.get(name);
    if (!bytes) throw new Error("unavailable");
    return object(name, bytes);
  };
  return { run, job, files, request };
}
const options = (request) => ({
  runId,
  productNames: ["007_schema.sql"],
  authNames: ["001_schema.sql"],
  request,
});
void test("binds successful production migration to immutable GitHub contents", async () => {
  const f = await fixture(),
    result = await verifyMigrationArtifact(options(f.request));
  assert.equal(result.commitSha, sha);
  assert.equal(result.workflow, ".github/workflows/deploy.yaml");
  assert.match(result.artifactDigest, /^[a-f0-9]{64}$/);
  assert.equal(Object.keys(result.files).length, 2);
  assert.deepEqual(await verifyMigrationArtifact(options(f.request)), result);
});
void test("rejects foreign, skipped, failed or wrong-attempt production evidence", async () => {
  for (const mutate of [
    (f) => (f.run.repository.full_name = "other/quorem"),
    (f) => (f.run.head_branch = "dev"),
    (f) => (f.run.conclusion = "failure"),
    (f) => (f.run.path = ".github/workflows/other.yaml"),
    (f) => (f.job.steps[1].conclusion = "skipped"),
    (f) => (f.job.name = "build"),
    (f) => f.job.steps.reverse().forEach((step, i) => (step.number = i + 1)),
  ]) {
    const f = await fixture();
    mutate(f);
    await assert.rejects(verifyMigrationArtifact(options(f.request)), /verification failed/);
  }
});
void test("rejects changed checkout, missing migration, traversal and redacts transport errors", async () => {
  for (const edit of [
    (text) => text.replaceAll("          fetch-depth: 0", "          ref: refs/heads/dev"),
    (text) => text.replace("vp -C apps/auth run migrate", "echo skipped"),
  ]) {
    const f = await fixture();
    const path = ".github/workflows/deploy.yaml";
    f.files.set(path, Buffer.from(edit(f.files.get(path).toString())));
    await assert.rejects(verifyMigrationArtifact(options(f.request)), /verification failed/);
  }
  const f = await fixture();
  await assert.rejects(
    verifyMigrationArtifact({ ...options(f.request), productNames: ["../secret.sql"] }),
    /verification failed/,
  );
  await assert.rejects(
    verifyMigrationArtifact(
      options(async () => {
        throw new Error("secret-value");
      }),
    ),
    (error) => !String(error).includes("secret-value"),
  );
});

void test("paginates exact run attempt and rejects incomplete or oversized results", async () => {
  const f = await fixture(),
    path = `${root}/actions/runs/${runId}/attempts/2/jobs?per_page=100&page=`;
  const request = async (p) =>
    p === `${path}1`
      ? { total_count: 101, jobs: Array.from({ length: 100 }, (_, i) => ({ name: `other-${i}` })) }
      : p === `${path}2`
        ? { total_count: 101, jobs: [f.job] }
        : f.request(p);
  assert.equal((await verifyMigrationArtifact(options(request))).commitSha, sha);
  await assert.rejects(
    verifyMigrationArtifact(
      options(async (p) => (p === `${path}1` ? { total_count: 101, jobs: [f.job] } : f.request(p))),
    ),
    /verification failed/,
  );
  await assert.rejects(
    verifyMigrationArtifact(
      options(async (p) => (p === `${path}1` ? { total_count: 1001, jobs: [] } : f.request(p))),
    ),
    /verification failed/,
  );
});
void test("fails closed on tampered contents and unreviewed migration owners", async () => {
  const f = await fixture();
  const request = async (path) => {
    const result = await f.request(path);
    if (path.includes("contents/apps/api/migrations/007_schema.sql")) result.sha = "0".repeat(40);
    return result;
  };
  await assert.rejects(verifyMigrationArtifact(options(request)), /verification failed/);
  const name = "apps/auth/src/migrations.ts";
  f.files.set(name, Buffer.from(f.files.get(name).toString() + "\n// changed"));
  await assert.rejects(verifyMigrationArtifact(options(f.request)), /verification failed/);
});
