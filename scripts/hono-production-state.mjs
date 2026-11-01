/** @file hono-production-state.mjs @description Private production state discovery. @module deployment */
import { terraformBackendArgs } from "./hono-terraform-backend.mjs";
import { runStageCommand } from "./hono-stage-command.mjs";

/** Read existing production ownership without applying a Terraform plan. */
export function productionState(env) {
  if (!/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID ?? "") || !env.TF_STATE_BUCKET)
    throw new Error("Invalid production backend");
  const states = {};
  for (const stack of ["database", "app"]) {
    runStageCommand("terraform", terraformBackendArgs(env, stack), env);
    states[stack] = JSON.parse(
      runStageCommand("terraform", [`-chdir=infra/terraform/${stack}`, "state", "pull"], env),
    );
  }
  const resource = (type, name) =>
    states.app.resources?.find(
      (item) => item.mode === "managed" && item.type === type && item.name === name,
    )?.instances?.[0]?.attributes;
  if (!resource("cloudflare_worker", "app")) {
    runStageCommand("terraform", terraformBackendArgs(env, "hono-production"), env);
    const saved = JSON.parse(
      runStageCommand(
        "terraform",
        ["-chdir=infra/terraform/hono-production", "output", "-json"],
        env,
      ),
    );
    if (!saved.secrets?.value?.LEGACY_APP_STATE) throw new Error("Production identity mismatch");
    states.retiredApp = states.app;
    states.app = JSON.parse(saved.secrets.value.LEGACY_APP_STATE);
  }
  const worker = resource("cloudflare_worker", "app");
  const bindings = resource("cloudflare_worker_version", "app")?.bindings ?? [];
  const binding = (name) => bindings.find((item) => item.name === name)?.text;
  const runtime = JSON.parse(binding("APP_RUNTIME_ENV") ?? "{}");
  const databaseURL = states.database.outputs?.database_url?.value;
  const url = new URL(databaseURL);
  const project = states.database.resources?.find(
    (item) => item.type === "neon_project" && item.name === "production",
  )?.instances?.[0]?.attributes?.id;
  if (
    worker?.name !== "quorem-production" ||
    runtime.AUTH_ORIGIN !== "https://quorem.app" ||
    project !== env.NEON_PROJECT_ID ||
    !url.pathname ||
    url.pathname === "/quorem_hono_stage" ||
    runtime.DATABASE_URL !== databaseURL
  ) {
    const error = new Error("Production identity mismatch");
    error.diagnostic = {
      workerMatches: worker?.name === "quorem-production",
      originMatches: runtime.AUTH_ORIGIN === "https://quorem.app",
      databaseMatches: project === env.NEON_PROJECT_ID,
      runtimeDatabaseMatches: runtime.DATABASE_URL === databaseURL,
      bindingNames: bindings.map((item) => item.name),
      runtimeKeys: Object.keys(runtime),
      resourceNames: (states.app.resources ?? []).map((item) => `${item.type}.${item.name}`),
    };
    throw error;
  }
  return { states, resource, worker, runtime, databaseURL, binding };
}
