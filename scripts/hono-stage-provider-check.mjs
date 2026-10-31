/** Read-only provider checks; report only the adapters' redacted metadata. */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { stageIntent } from "./hono-stage-intent.mjs";
import { requirePrivateStageState } from "./hono-stage-state.mjs";
import { requireFreshStageResources } from "./hono-stage-freshness.mjs";

export async function checkStageProvider(
  env,
  {
    state = requirePrivateStageState,
    freshness = requireFreshStageResources,
    fresh = true,
    report = () => {},
  } = {},
) {
  report("check-state-privacy");
  const checks = [state(env, undefined, report)];
  if (fresh) {
    report("check-stage-freshness");
    checks.push(
      freshness(
        {
          ...env,
          TF_VAR_worker_name: "quorem-hono-stage",
          HONO_SERVICES_WORKER_NAME: "quorem-hono-services-stage",
        },
        undefined,
        report,
      ),
    );
  }
  const results = await Promise.allSettled(checks);
  if (results.some((result) => result.status === "rejected"))
    throw new Error("Stage provider preflight failed");
  return { status: "verified", checks: results.length };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(
      JSON.stringify(
        await checkStageProvider(process.env, {
          fresh: stageIntent(process.env) === "stage",
          report: (phase, metadata) => console.log(JSON.stringify({ phase, metadata })),
        }),
      ),
    );
  } catch {
    console.error("Stage provider preflight failed; see redacted metadata above");
    process.exitCode = 1;
  }
}
