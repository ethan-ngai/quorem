/** Attach only after manual acceptance and detach on any uncertain automatic proof. */
import { spawnSync } from "node:child_process";
import { validateStageRequest } from "./hono-stage-deploy.mjs";
import { hostedAcceptance } from "./hono-stage-deploy-acceptance.mjs";
import { verifyPrivateIngress } from "./hono-stage-deploy-ingress.mjs";

export function setQueue(env, enabled, run = spawnSync) {
  validateStageRequest({ ...env, TF_VAR_enable_queue_consumer: "false" });
  if (env.HONO_STAGE_ACTION !== "stage") throw new Error("Explicit stage action required");
  const allowed = [
    "PATH",
    "HOME",
    "USER",
    "TMPDIR",
    "CI",
    "CLOUDFLARE_API_TOKEN",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "TF_IN_AUTOMATION",
    "TF_VAR_account_id",
    "TF_VAR_worker_name",
    "TF_VAR_stage_hostname",
    "TF_VAR_drain_hostname",
    "TF_VAR_access_service_token_ids",
    "TF_VAR_drain_access_service_token_id",
    "TF_VAR_database_host",
    "TF_VAR_database_port",
    "TF_VAR_database_name",
    "TF_VAR_database_user",
    "TF_VAR_database_password",
    "TF_VAR_database_connection_limit",
  ];
  const childEnv = Object.fromEntries(
    allowed.filter((name) => env[name] !== undefined).map((name) => [name, env[name]]),
  );
  childEnv.TF_VAR_enable_queue_consumer = String(enabled);
  const result = run(
    "terraform",
    [
      "-chdir=infra/terraform/hono-stage",
      "apply",
      "-input=false",
      "-auto-approve",
      "-lock-timeout=5m",
    ],
    { env: childEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (result.error || result.status !== 0)
    throw new Error("Queue change failed; provider output withheld");
}
export async function releaseQueue(
  env,
  namespace,
  { accept = hostedAcceptance, ingress = verifyPrivateIngress, change = setQueue } = {},
) {
  validateStageRequest({ ...env, TF_VAR_enable_queue_consumer: "false" });
  if (
    env.HONO_STAGE_ACTION !== "stage" ||
    !/^[a-f0-9]{64}$/.test(namespace ?? "") ||
    namespace === "0".repeat(64) ||
    namespace !== env.TF_VAR_case_namespace_id
  )
    throw new Error("Verified staged namespace required");
  await accept({ ...env, HONO_STAGE_ACCEPTANCE_MODE: "manual" });
  await ingress(env, namespace);
  let attempted = false;
  try {
    attempted = true;
    await Promise.resolve(change(env, true));
    await accept({ ...env, HONO_STAGE_ACCEPTANCE_MODE: "queue" });
  } catch {
    if (attempted) {
      try {
        await Promise.resolve(change(env, false));
      } catch {
        throw new Error("Queue proof failed and detachment is unconfirmed");
      }
    }
    throw new Error("Queue proof failed; consumer detached");
  }
}
