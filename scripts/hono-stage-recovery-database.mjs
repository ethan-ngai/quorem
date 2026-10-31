/** Page retained attempt authority only while the stage runtime is demonstrably fenced. */
import { assertStageRuntimeFenced, stageRecoveryLockKey } from "./hono-stage-recovery-fence.mjs";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export async function readStageAttemptPage(client, { scope, role, after = "", limit = 100 }) {
  if (
    !/^remote:[a-f0-9]{64}$/.test(scope ?? "") ||
    !/^quorem_stage_runtime_[a-f0-9]{12,32}$/.test(role ?? "") ||
    (after !== "" && !uuid.test(after)) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new Error("Invalid stage attempt page");
  // Bound client waits as well as server execution, including fence checks.
  const db = { query: (text, values) => client.query({ text, values, query_timeout: 7000 }) };
  let begun = false;
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    begun = true;
    await db.query("SET LOCAL statement_timeout = '5s'");
    await db.query("SET LOCAL lock_timeout = '1s'");
    const lock = await db.query(
      "SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired",
      [stageRecoveryLockKey],
    );
    if (lock.rows[0]?.acquired !== true) throw new Error("Stage recovery is already running");
    await assertStageRuntimeFenced(db, role);
    const invalid = await db.query(
      `SELECT EXISTS (
      SELECT 1 FROM public.execution_jobs j LEFT JOIN public.execution_attempt_inventory i ON i.attempt_id=j.attempt_id
      WHERE j.attempt_id IS NOT NULL AND (j.sandbox_scope IS DISTINCT FROM $1 OR i.attempt_id IS NULL OR i.job_id IS DISTINCT FROM j.id OR i.sandbox_scope IS DISTINCT FROM j.sandbox_scope)
    ) OR EXISTS (SELECT 1 FROM public.execution_attempt_inventory WHERE sandbox_scope IS DISTINCT FROM $1) AS invalid`,
      [scope],
    );
    if (invalid.rows[0]?.invalid !== false)
      throw new Error("Current attempt authority unavailable");
    const rows = (
      await db.query(
        `SELECT attempt_id::text AS "attemptId", job_id::text AS "jobId" FROM public.execution_attempt_inventory WHERE sandbox_scope=$1 AND ($2::uuid IS NULL OR attempt_id>$2::uuid) ORDER BY attempt_id LIMIT $3`,
        [scope, after || null, limit + 1],
      )
    ).rows;
    await db.query("COMMIT");
    begun = false;
    const more = rows.length > limit,
      attempts = rows.slice(0, limit);
    return { attempts, next: more ? attempts.at(-1).attemptId : null };
  } catch (error) {
    if (begun) await db.query("ROLLBACK").catch(() => {});
    throw error;
  }
}
