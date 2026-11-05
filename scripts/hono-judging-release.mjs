/** Shared scope transition checks for coordinated production judging releases. */
import { remoteSandbox } from "../apps/runner/src/sandbox/remote.ts";
export async function judgingScopeIdle(database) {
  const {
    rows: [row],
  } = await database.query(
    "SELECT NOT EXISTS(SELECT 1 FROM execution_jobs j WHERE NOT j.finished AND (j.attempt_id IS NOT NULL OR EXISTS(SELECT 1 FROM execution_checkpoints c WHERE c.job_id=j.id AND c.next_ordinal>0))) AS idle",
  );
  return row?.idle === true;
}
/** A repair may preserve attempts only when every retained fence uses the exact protocol scope. */
export async function judgingScopeCompatible(database, scope) {
  if (!/^remote:[a-f0-9]{64}$/.test(scope ?? "")) throw new Error("Invalid preserved scope");
  const {
    rows: [row],
  } = await database.query(
    "SELECT NOT EXISTS(SELECT 1 FROM execution_jobs j WHERE NOT j.finished AND j.sandbox_scope IS NOT NULL AND j.sandbox_scope<>$1) AS compatible",
    [scope],
  );
  return row?.compatible === true;
}
export function judgingPeerSecret(keys, service, release) {
  if (
    !/^[a-f0-9]{40}$/.test(release ?? "") ||
    service.SERVICES_RELEASE !== release ||
    service.QUOREM_CASE_ORIGIN !== "https://case-hono.quorem.app" ||
    service.QUOREM_CASE_NAMESPACE_ID === "0".repeat(64)
  )
    throw new Error("Private services must match scope update release");
  const sandbox = remoteSandbox({
    origin: service.QUOREM_CASE_ORIGIN,
    secret: keys.QUOREM_CASE_SECRET,
    namespaceId: service.QUOREM_CASE_NAMESPACE_ID,
    ownerPublicKey: keys.QUOREM_CASE_OWNER_PUBLIC_KEY_PEM,
    cleanupMs: 30000,
  });
  if (
    typeof keys.QUOREM_RUNNER_COMMAND_SECRET !== "string" ||
    keys.QUOREM_RUNNER_COMMAND_SECRET.length < 32 ||
    /\s/.test(keys.QUOREM_RUNNER_COMMAND_SECRET)
  )
    throw new Error("Invalid runner scope credential");
  return JSON.stringify([
    { secret: keys.QUOREM_RUNNER_COMMAND_SECRET, scope: sandbox.scope, resumable: true },
  ]);
}
