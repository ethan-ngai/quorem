import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, chmod, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveStageRole } from "./hono-stage-database-role.mjs";
import { maintenanceJournal } from "./hono-stage-maintenance-journal.mjs";
import { maintainStage } from "./hono-stage-maintenance.mjs";
import { runStageMaintenance } from "./hono-stage-maintenance-run.mjs";

function fixture() {
  const prior = {
    generation: 2,
    release: "a".repeat(40),
    bindings: "b".repeat(64),
    initialOperation: randomUUID(),
    initialRelease: "c".repeat(40),
  };
  const plan = {
    namespace: "d".repeat(64),
    scope: `remote:${"e".repeat(64)}`,
    prior,
    role: deriveStageRole(prior.release, "2"),
    operation: randomUUID(),
    runnerOperation: randomUUID(),
    caseOperation: randomUUID(),
  };
  const calls = [],
    events = [],
    removed = [];
  const dbId = "10000000-0000-4000-8000-000000000000",
    caseId = "case-only";
  const operations = {
    journal: { record: async (event, evidence) => events.push({ event, evidence }) },
    database: {
      query: async (sql) => {
        calls.push(sql.includes("unlock") ? "unlock" : "lock");
        return { rows: [{ acquired: true }] };
      },
    },
    detach: async () => {
      calls.push("detach");
    },
    controls: {
      pausePinned: async () => {
        calls.push("pause");
        return { proofs: ["signed"] };
      },
      inventoryPage: async (after) => ({
        after,
        attempts: after ? [caseId] : [dbId],
        next: after ? null : dbId,
        proof: "signed",
      }),
    },
    fence: async () => {
      calls.push("fence");
      return { disabled: true };
    },
    databasePage: async () => ({
      attempts: [{ attemptId: dbId, jobId: randomUUID() }],
      next: null,
    }),
    teardown: async (fence) => {
      assert.equal(fence.sandboxScope, plan.scope);
      removed.push(fence.attemptId);
    },
  };
  return { plan, operations, calls, events, removed, dbId, caseId };
}
void test("maintenance reconciles both inventories and verifies each attempt once per execution", async () => {
  const f = fixture();
  const receipt = await maintainStage(f.plan, f.operations);
  assert.deepEqual(new Set(f.removed), new Set([f.dbId, f.caseId]));
  assert.deepEqual(f.calls, ["lock", "detach", "pause", "fence", "pause", "fence", "unlock"]);
  assert.equal(receipt.resumeReady, false);
  assert.equal(receipt.historyCoverage, "unverified");
  await maintainStage(f.plan, f.operations);
  assert.equal(f.removed.length, 4);
});
void test("lost detach acknowledgement still pauses and fences, then forbids teardown", async () => {
  const f = fixture();
  f.operations.detach = async () => {
    f.calls.push("detach");
    throw new Error("lost ACK");
  };
  await assert.rejects(maintainStage(f.plan, f.operations), /containment unconfirmed/);
  assert.deepEqual(f.calls, ["lock", "detach", "pause", "fence", "unlock"]);
  assert.equal(f.removed.length, 0);
});
void test("uncertain teardown never records completion and retry rechecks containment", async () => {
  const f = fixture(),
    original = f.operations.teardown;
  f.operations.teardown = async () => {
    throw new Error("unconfirmed signature");
  };
  await assert.rejects(maintainStage(f.plan, f.operations), /unconfirmed signature/);
  assert.equal(
    f.events.some((row) => row.event === "completed"),
    false,
  );
  f.operations.teardown = original;
  await maintainStage(f.plan, f.operations);
  assert.equal(f.calls.filter((call) => call === "fence").length, 3);
});
void test("malformed authority or nonadvancing inventory cannot reach teardown", async () => {
  const f = fixture();
  await assert.rejects(
    maintainStage({ ...f.plan, role: deriveStageRole("f".repeat(40), "2") }, f.operations),
    /Invalid maintenance plan/,
  );
  assert.equal(f.calls.length, 0);
  f.operations.controls.inventoryPage = async (after) => ({ after, attempts: [], next: "loop" });
  await assert.rejects(maintainStage(f.plan, f.operations), /Nonadvancing/);
  assert.equal(f.removed.length, 0);
});
void test("operator entrypoint rejects implicit action and production branch before credentials or journal access", async () => {
  const { plan } = fixture();
  await assert.rejects(runStageMaintenance({}, plan, undefined), /Explicit maintenance/);
  await assert.rejects(
    runStageMaintenance(
      { HONO_STAGE_ACTION: "maintenance", GITHUB_REF: "refs/heads/main" },
      plan,
      undefined,
    ),
    /Migration branch required/,
  );
});
void test("journal persists operation IDs and refuses changed plans, public files and symlinks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hono-maintenance-test-")),
    f = fixture();
  try {
    const journal = await maintenanceJournal(directory, f.plan);
    await journal.record("started", { operation: f.plan.operation });
    await maintenanceJournal(directory, f.plan);
    assert.equal(
      JSON.parse(await readFile(join(directory, "plan.json"), "utf8")).operation,
      f.plan.operation,
    );
    await assert.rejects(
      maintenanceJournal(directory, { ...f.plan, operation: randomUUID() }),
      /plan changed/,
    );
    await chmod(join(directory, "plan.json"), 0o644);
    await assert.rejects(maintenanceJournal(directory, f.plan), /Private maintenance plan/);
    await chmod(join(directory, "plan.json"), 0o600);
    await rm(join(directory, "events.ndjson"));
    await symlink(join(directory, "plan.json"), join(directory, "events.ndjson"));
    await assert.rejects(journal.record("completed", {}));
    assert.equal(
      JSON.parse(await readFile(join(directory, "plan.json"), "utf8")).operation,
      f.plan.operation,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
