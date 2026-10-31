/** Quiesce an existing stage, preserving data and refusing to authorize resume. */
import { deriveStageRole } from "./hono-stage-database-role.mjs";
import { stageRecoveryLockKey } from "./hono-stage-recovery-fence.mjs";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function validateMaintenancePlan(plan) {
  const keys = "caseOperation,namespace,operation,prior,role,runnerOperation,scope";
  const priorKeys = "bindings,generation,initialOperation,initialRelease,release";
  const prior = plan?.prior;
  if (
    !plan ||
    Object.keys(plan).sort().join() !== keys ||
    !prior ||
    Object.keys(prior).sort().join() !== priorKeys ||
    !/^[a-f0-9]{64}$/.test(plan.namespace ?? "") ||
    plan.namespace === "0".repeat(64) ||
    !/^remote:[a-f0-9]{64}$/.test(plan.scope ?? "") ||
    ![plan.operation, plan.runnerOperation, plan.caseOperation, prior.initialOperation].every(
      (id) => uuid.test(id ?? ""),
    ) ||
    new Set([plan.operation, plan.runnerOperation, plan.caseOperation, prior.initialOperation])
      .size !== 4 ||
    !Number.isSafeInteger(prior.generation) ||
    prior.generation < 1 ||
    prior.generation >= Number.MAX_SAFE_INTEGER - 1 ||
    !/^[a-f0-9]{40}$/.test(prior.release ?? "") ||
    !/^[a-f0-9]{40}$/.test(prior.initialRelease ?? "") ||
    !/^[a-f0-9]{64}$/.test(prior.bindings ?? "") ||
    plan.role !== deriveStageRole(prior.release, String(prior.generation))
  )
    throw new Error("Invalid maintenance plan");
  return plan;
}

/** All dependencies operate on the plan's immutable namespace, scope and runtime role. */
export async function maintainStage(plan, operations) {
  validateMaintenancePlan(plan);
  const { journal, controls, database, detach, fence, databasePage, teardown } = operations;
  const lock = stageRecoveryLockKey;
  const acquired = await database.query(
    "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired",
    [lock],
  );
  if (acquired.rows[0]?.acquired !== true) throw new Error("Stage maintenance already running");
  try {
    await journal.record("started", { operation: plan.operation });
    // Independently attempt all containment steps, even if an earlier acknowledgement is lost.
    const failures = [];
    for (const [name, run] of [
      ["queue-detached", detach],
      [
        "controls-paused",
        () =>
          controls.pausePinned({
            prior: plan.prior,
            runnerOperation: plan.runnerOperation,
            caseOperation: plan.caseOperation,
          }),
      ],
      ["writers-fenced", () => fence(database, plan.role)],
    ]) {
      try {
        const result = await run();
        await journal.record(name, result ?? { confirmed: true });
      } catch {
        failures.push(name);
      }
    }
    if (failures.length)
      throw new Error(`Maintenance containment unconfirmed: ${failures.join(", ")}`);
    const attempts = new Set();
    const add = (id) => {
      if (typeof id !== "string" || !/^[A-Za-z0-9-]{1,128}$/.test(id))
        throw new Error("Invalid attempt inventory");
      attempts.add(id);
      if (attempts.size > 10000) throw new Error("Maintenance attempt budget exceeded");
    };
    const collect = async ({ read, id, event, limit, signed = false }) => {
      let after = "";
      for (let pages = 0; ; pages++) {
        if (pages >= 10001) throw new Error("Maintenance page budget exceeded");
        const page = await read(after);
        if (
          (signed && page.after !== after) ||
          !Array.isArray(page.attempts) ||
          page.attempts.length > limit
        )
          throw new Error("Invalid maintenance inventory");
        let previous = after;
        for (const row of page.attempts) {
          const attempt = id(row);
          if (attempt <= previous) throw new Error("Nonadvancing maintenance inventory");
          add(attempt);
          previous = attempt;
        }
        await journal.record(event, page);
        if (page.next === null) break;
        if (!page.attempts.length || page.next !== previous || page.next <= after)
          throw new Error("Nonadvancing maintenance inventory");
        after = page.next;
      }
    };
    await collect({
      read: (after) => databasePage(database, { scope: plan.scope, role: plan.role, after }),
      id: (row) => row.attemptId,
      event: "database-inventory",
      limit: 100,
    });
    await collect({
      read: (after) => controls.inventoryPage(after),
      id: (row) => row,
      event: "case-inventory",
      limit: 4,
      signed: true,
    });
    for (const attemptId of [...attempts].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      await teardown({ sandboxScope: plan.scope, attemptId });
      await journal.record("attempt-teardown", { attemptId, confirmed: true });
    }
    await controls.pausePinned({
      prior: plan.prior,
      runnerOperation: plan.runnerOperation,
      caseOperation: plan.caseOperation,
    });
    await fence(database, plan.role);
    const receipt = {
      operation: plan.operation,
      namespace: plan.namespace,
      scope: plan.scope,
      generation: plan.prior.generation,
      knownAttempts: attempts.size,
      historyCoverage: "unverified",
      resumeReady: false,
      cutoverReady: false,
    };
    await journal.record("completed", receipt);
    return receipt;
  } finally {
    await database.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [lock]);
  }
}
