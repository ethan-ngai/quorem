import { deriveStageRole } from "./hono-stage-database-role.mjs";
/** Staged deployment control: mutation stays disabled until hosted proof is implemented. */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function validateStageRequest(env, { requireImages = true } = {}) {
  if (!["plan", "stage"].includes(env.HONO_STAGE_ACTION)) throw new Error("Invalid stage action");
  if (env.GITHUB_REF !== "refs/heads/feat/hono-migration")
    throw new Error("Migration branch required");
  if (!/^[0-9a-f]{40}$/.test(env.HONO_RELEASE_SHA ?? "") || env.HONO_RELEASE_SHA !== env.GITHUB_SHA)
    throw new Error("Release must match the exact workflow revision");
  if (env.TF_VAR_database_name !== "quorem_hono_stage")
    throw new Error("Isolated stage database required");
  if (!/^[a-z][a-z0-9-]*-hono-stage$/.test(env.TF_VAR_worker_name ?? ""))
    throw new Error("Isolated stage Worker required");
  if (!/^[a-z][a-z0-9-]*-hono-services-stage$/.test(env.HONO_SERVICES_WORKER_NAME ?? ""))
    throw new Error("Isolated services Worker required");
  if (
    !/^[0-9a-f]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID ?? "") ||
    !/^[a-z0-9][a-z0-9-]{2,62}$/.test(env.TF_STATE_BUCKET ?? "")
  )
    throw new Error("Invalid stage backend");
  const host = (v) =>
    typeof v === "string" && /^([a-z0-9]+-)*stag(e|ing)(-[a-z0-9]+)*(\.[a-z0-9-]+)+$/.test(v);
  let names, images, apiTokens, serviceTokens;
  try {
    names = JSON.parse(env.TF_VAR_hostnames);
    apiTokens = JSON.parse(env.TF_VAR_access_service_token_ids);
    serviceTokens = JSON.parse(env.TF_VAR_access_token_ids);
    images = requireImages ? JSON.parse(env.TF_VAR_case_images) : undefined;
  } catch {
    throw new Error("Invalid staged hosts or images");
  }
  const tokenId = (v) =>
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
  if (
    !Array.isArray(apiTokens) ||
    !apiTokens.length ||
    !apiTokens.every(tokenId) ||
    !serviceTokens ||
    !tokenId(serviceTokens.drain) ||
    apiTokens.includes(serviceTokens.drain)
  )
    throw new Error("Drain and API Access tokens must be distinct");
  if (
    !host(env.TF_VAR_stage_hostname) ||
    !names ||
    ![names.drain, names.verifier, names.case].every(host) ||
    new Set([env.TF_VAR_stage_hostname, names.drain, names.verifier, names.case]).size !== 4 ||
    env.TF_VAR_command_origin !== `https://${env.TF_VAR_stage_hostname}` ||
    env.TF_VAR_source_origin !== env.TF_VAR_command_origin
  )
    throw new Error("Distinct staged origins required");
  const digest = (v) =>
    typeof v === "string" &&
    new RegExp(
      `^registry\\.cloudflare\\.com/${env.CLOUDFLARE_ACCOUNT_ID}/[a-z0-9-]+@sha256:[0-9a-f]{64}$`,
    ).test(v);
  if (
    requireImages &&
    (!images ||
      ![
        env.TF_VAR_runner_image,
        env.TF_VAR_verifier_image,
        ...["python", "java", "typescript", "ocaml", "postgresql"].map((k) => images[k]),
      ].every(digest))
  )
    throw new Error("Immutable staged image digests required");
  const profile = env.TF_VAR_profile_media_enabled ?? "false";
  if (!["true", "false"].includes(profile)) throw new Error("Invalid profile media flag");
  if (
    profile === "true" &&
    (!host(env.TF_VAR_image_hostname) ||
      [env.TF_VAR_stage_hostname, names.drain, names.verifier, names.case].includes(
        env.TF_VAR_image_hostname,
      ) ||
      !/^[0-9a-f-]{36}$/.test(env.TF_VAR_image_access_service_token_id ?? "") ||
      (requireImages && !digest(env.TF_VAR_image_service_image)))
  )
    throw new Error("Invalid staged image service");
  if (!/^[0-9a-f]{64}$/.test(env.TF_VAR_case_namespace_id ?? ""))
    throw new Error("Explicit case namespace required");
  if (env.TF_VAR_enable_queue_consumer !== "false") throw new Error("Queue must remain disabled");
}

export function terraformInitArgs(env, stack) {
  if (!["hono-stage", "hono-services", "hono-bootstrap"].includes(stack)) throw new Error("Invalid Terraform stack");
  const endpoint = `endpoints={s3="https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com"}`;
  return [
    "-chdir=infra/terraform/" + stack,
    "init",
    "-input=false",
    `-backend-config=bucket=${env.TF_STATE_BUCKET}`,
    `-backend-config=key=${stack}/terraform.tfstate`,
    "-backend-config=region=auto",
    `-backend-config=${endpoint}`,
    "-backend-config=skip_credentials_validation=true",
    "-backend-config=skip_region_validation=true",
    "-backend-config=skip_requesting_account_id=true",
    "-backend-config=skip_metadata_api_check=true",
    "-backend-config=skip_s3_checksum=true",
    "-backend-config=use_lockfile=true",
  ];
}

export function runPlan(env, run = spawnSync) {
  validateStageRequest(env);
  if (env.HONO_STAGE_ACTION !== "plan") throw new Error("Stage deployment is not yet enabled");
  const summaries = [];
  for (const stack of ["hono-stage", "hono-services"]) {
    const stackEnv = {
      ...env,
      TF_VAR_database_user: deriveStageRole(
        env.HONO_RELEASE_SHA,
        env.TF_VAR_release_generation ?? "1",
      ),
      TF_VAR_release_sha: env.HONO_RELEASE_SHA,
      TF_VAR_release_generation: env.TF_VAR_release_generation ?? "1",
      TF_VAR_worker_name:
        stack === "hono-stage" ? env.TF_VAR_worker_name : env.HONO_SERVICES_WORKER_NAME,
    };
    const init = terraformInitArgs(env, stack);
    for (const args of [
      init,
      ["-chdir=infra/terraform/" + stack, "plan", "-input=false", "-no-color", "-lock-timeout=5m"],
    ]) {
      const result = run("terraform", args, {
        env: stackEnv,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (result.error || result.status !== 0)
        throw new Error(`Stage ${stack} plan failed; provider output withheld`);
      if (args[1] === "plan") {
        const lines = (result.stdout ?? "").split("\n");
        const actions = lines
          .map((line) =>
            /^  # ([a-z0-9_]+\.[a-z0-9_]+(?:\[(?:[0-9]+|"[a-z0-9_-]+")\])?) (will be created|will be updated in-place|will be destroyed|must be replaced)$/.exec(
              line,
            ),
          )
          .filter(Boolean)
          .map((match) => `${match[1]} ${match[2]}`);
        const summary =
          lines.find((line) =>
            /^Plan: [0-9]+ to add, [0-9]+ to change, [0-9]+ to destroy\.$/.test(line),
          ) ?? (lines.some((line) => line.startsWith("No changes.")) ? "No changes." : undefined);
        if (!summary) throw new Error(`Stage ${stack} plan summary unavailable`);
        summaries.push({ stack, actions, summary });
      }
    }
  }
  return summaries;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const summaries = runPlan(process.env);
    process.stdout.write(`${JSON.stringify(summaries)}\n`);
  } catch {
    process.stderr.write("Stage request failed; configuration or provider output withheld.\n");
    process.exitCode = 1;
  }
}
