/** Attach only after manual acceptance and detach on any uncertain automatic proof. */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateStageRequest } from "./hono-stage-deploy.mjs";
import { hostedAcceptance } from "./hono-stage-deploy-acceptance.mjs";
import { verifyPrivateIngress } from "./hono-stage-deploy-ingress.mjs";
import { verifyHostedProfile } from "./hono-stage-deploy-profile.mjs";

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
    "TF_VAR_database_host",
    "TF_VAR_database_port",
    "TF_VAR_database_name",
    "TF_VAR_database_user",
    "TF_VAR_database_password",
    "TF_VAR_database_connection_limit",
    "TF_VAR_profile_media_enabled",
  ];
  const childEnv = Object.fromEntries(
    allowed.filter((name) => env[name] !== undefined).map((name) => [name, env[name]]),
  );
  childEnv.TF_VAR_enable_queue_consumer = String(enabled);
  const directory = mkdtempSync(join(tmpdir(), "quorem-stage-queue-"));
  const plan = join(directory, "consumer.tfplan");
  const execute = (args) => {
    const result = run("terraform", args, {
      env: childEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error || result.status !== 0)
      throw new Error("Queue change failed; provider output withheld");
    return result.stdout ?? "";
  };
  try {
    chmodSync(directory, 0o700);
    execute([
      "-chdir=infra/terraform/hono-stage",
      "plan",
      "-input=false",
      "-no-color",
      "-lock-timeout=5m",
      "-target=cloudflare_queue_consumer.execution",
      `-out=${plan}`,
    ]);
    chmodSync(plan, 0o600);
    let view;
    try {
      view = JSON.parse(execute(["-chdir=infra/terraform/hono-stage", "show", "-json", plan]));
    } catch {
      throw new Error("Queue plan cannot be validated");
    }
    const address = "cloudflare_queue_consumer.execution[0]";
    if (!Array.isArray(view.resource_changes) || !view.planned_values?.root_module)
      throw new Error("Queue plan cannot be validated");
    for (const change of [...view.resource_changes, ...(view.resource_drift ?? [])]) {
      const actions = change.change?.actions;
      if (!Array.isArray(actions)) throw new Error("Queue plan cannot be validated");
      if (actions.length === 1 && actions[0] === "no-op") continue;
      if (
        change.address !== address ||
        actions.length !== 1 ||
        actions[0] !== (enabled ? "create" : "delete")
      )
        throw new Error("Queue plan includes unrelated changes");
    }
    const root = view.planned_values.root_module;
    if (root.child_modules?.length) throw new Error("Queue plan contains unexpected modules");
    const consumers = (root.resources ?? []).filter(
      (resource) => resource.address === address && resource.mode === "managed",
    );
    if (consumers.length !== (enabled ? 1 : 0))
      throw new Error("Queue plan has unexpected consumer state");
    execute([
      "-chdir=infra/terraform/hono-stage",
      "apply",
      "-input=false",
      "-no-color",
      "-lock-timeout=5m",
      plan,
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
export async function releaseQueue(
  env,
  namespace,
  {
    accept = hostedAcceptance,
    ingress = verifyPrivateIngress,
    profile = verifyHostedProfile,
    change = setQueue,
  } = {},
) {
  validateStageRequest({ ...env, TF_VAR_enable_queue_consumer: "false" });
  if (
    env.HONO_STAGE_ACTION !== "stage" ||
    !/^[a-f0-9]{64}$/.test(namespace ?? "") ||
    namespace === "0".repeat(64) ||
    namespace !== env.TF_VAR_case_namespace_id
  )
    throw new Error("Verified staged namespace required");
  const manual = await accept({ ...env, HONO_STAGE_ACCEPTANCE_MODE: "manual" });
  await ingress(env, namespace);
  if (env.PROFILE_MEDIA_ENABLED === "true") await profile(env);
  let attempted = false;
  try {
    attempted = true;
    await Promise.resolve(change(env, true));
    const automatic = await accept({ ...env, HONO_STAGE_ACCEPTANCE_MODE: "queue" });
    return { manual: manual.submission, automatic: automatic.submission };
  } catch (error) {
    if (attempted) {
      try {
        await Promise.resolve(change(env, false));
      } catch {
        throw new Error("Queue proof failed and detachment is unconfirmed");
      }
    }
    throw new Error("Queue proof failed; consumer detached", { cause: error });
  }
}
