/** Provision a fresh isolated stage; provider credentials and state never leave the job. */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stageIntent } from "./hono-stage-intent.mjs";
import { assembleStageConfig, createStageSecrets } from "./hono-stage-bootstrap-config.mjs";
import { terraformInitArgs } from "./hono-stage-deploy.mjs";
import { publishImages } from "./hono-stage-deploy-images.mjs";
import { deployStage } from "./hono-stage-deploy-stage.mjs";
import { checkStageProvider } from "./hono-stage-provider-check.mjs";
import { requirePrivateStageState } from "./hono-stage-state.mjs";
import { stageNamespaceReady } from "./hono-stage-ready.mjs";
import { requireFreshStageResources } from "./hono-stage-freshness.mjs";

const stageResources = [
  "data.neon_branches.existing",
  "restapi_object.stage_branch",
  "neon_endpoint.stage",
  "neon_role.stage",
  "neon_database.stage",
  "terraform_data.stage_secrets",
];
function providerDiagnostics(text) {
  // Non-color Terraform omits box borders; split its plain Error headings as well.
  return text
    .replace(/^[ \t]*[│╷╵][ \t]?/gm, "")
    .split(/(?=^Error:)/m)
    .filter(Boolean)
    .map((chunk) => {
      const resources = stageResources.filter((name) => chunk.includes(name));
      const statuses = [
        ...chunk.matchAll(
          /\b(?:HTTP(?:\s+status)?|status(?:\s+code)?|response\s+code)\s*[:=]?\s*['"]?(400|401|403|404|409|422|423|429|500|502|503|504)\b/gi,
        ),
      ].map((match) => Number(match[1]));
      const codes =
        resources.length > 0
          ? [...chunk.matchAll(/(?:"code"\s*:\s*|\berror\s+code\s*[:=]\s*)(\d{1,6})\b/gi)].map(
              (match) => Number(match[1]),
            )
          : [];
      const flags = {
        schemaOnly: /schema[-_]only|parent[-_]schema/i.test(chunk),
        parent: /parent_id|parent branch.*required|parent.*not found/i.test(chunk),
        feature: /not supported|unsupported|not available|not enabled|early access|\bbeta\b/i.test(
          chunk,
        ),
        organization: /\b(?:(?:organization|organisation|org)[ -]scoped|org_id)\b/i.test(chunk),
        project: /\bproject[ -]scoped\b/i.test(chunk),
        authentication:
          /\b(?:unauthorized|unauthenticated|authentication failed|invalid (?:api )?(?:key|token))\b/i.test(
            chunk,
          ),
        permission:
          /\b(?:permission denied|insufficient permissions?|access denied|forbidden|not authorized)\b/i.test(
            chunk,
          ),
        quota:
          /\b(?:quota (?:exceeded|limit)|rate[ -]limit(?:ed| exceeded)?|too many requests)\b/i.test(
            chunk,
          ),
      };
      // Neon documents this field as a machine-readable error code, never response prose.
      const types = [...chunk.matchAll(/"code"\s*:\s*"([A-Za-z][A-Za-z0-9_]{1,79})"/g)].map(
        (match) => match[1],
      );
      return {
        resources,
        statuses: [...new Set(statuses)],
        codes: [...new Set(codes)],
        types: [...new Set(types)],
        flags,
      };
    })
    .filter(
      (item) =>
        item.resources.length ||
        item.statuses.length ||
        item.codes.length ||
        item.types.length ||
        Object.values(item.flags).some(Boolean),
    );
}
export class StageCommandFailure extends Error {
  constructor(result) {
    const text = result.stderr ?? "";
    const diagnostics = providerDiagnostics(text);
    const category = diagnostics.some(
      ({ statuses, flags }) =>
        flags.authentication ||
        flags.permission ||
        statuses.some((status) => status === 401 || status === 403),
    )
      ? "provider permission"
      : diagnostics.some(({ statuses, flags }) => flags.quota || statuses.includes(429))
        ? "provider limit"
        : "configuration/provider";
    super(`Stage command failed (${category}); output withheld`);
    this.category = category;
    this.diagnostics = diagnostics;
    this.resources = stageResources.filter((name) => text.includes(name));
    this.noState = /No state file was found/i.test(text);
  }
}
export function runStageCommand(program, args, env, execute = spawnSync) {
  const result = execute(program, args, {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new StageCommandFailure(result);
  return result.stdout ?? "";
}
export function bootstrapEnvironment(env, secrets) {
  if (
    env.GITHUB_REF !== "refs/heads/feat/hono-migration" ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "")
  )
    throw new Error("Exact migration release required");
  if (
    !/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID ?? "") ||
    !/^[a-z][a-z0-9-]{3,99}$/.test(env.NEON_PROJECT_ID ?? "") ||
    !/^[a-z0-9][a-z0-9-]{2,62}$/.test(env.TF_STATE_BUCKET ?? "")
  )
    throw new Error("Invalid stage backend");
  for (const name of [
    "CLOUDFLARE_API_TOKEN",
    "NEON_API_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
  ])
    if (!env[name]) throw new Error(`Missing ${name}`);
  const names = [
    "PATH",
    "HOME",
    "USER",
    "TMPDIR",
    "CI",
    "NODE_EXTRA_CA_CERTS",
    "CLOUDFLARE_API_TOKEN",
    "NEON_API_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
  ];
  return {
    ...Object.fromEntries(
      names.filter((name) => env[name] !== undefined).map((name) => [name, env[name]]),
    ),
    TF_IN_AUTOMATION: "true",
    TF_VAR_project_id: env.NEON_PROJECT_ID,
    TF_VAR_neon_api_key: env.NEON_API_KEY,
    TF_VAR_stage_secrets: JSON.stringify(secrets),
  };
}
export async function launchStage(
  env,
  {
    action = "plan",
    state = requirePrivateStageState,
    run = runStageCommand,
    createSecrets = createStageSecrets,
    assemble = assembleStageConfig,
    images = publishImages,
    activate = deployStage,
    freshness = requireFreshStageResources,
    mask = () => {},
    report = () => {},
  } = {},
) {
  if (!["plan", "stage"].includes(action)) throw new Error("Invalid stage action");
  const child = bootstrapEnvironment(env, createSecrets());
  await checkStageProvider(env, { state, freshness, fresh: action === "stage", report });
  const directory = mkdtempSync(join(tmpdir(), "quorem-hono-bootstrap-"));
  chmodSync(directory, 0o700);
  const plan = join(directory, "bootstrap.tfplan");
  const prefix = ["-chdir=infra/terraform/hono-bootstrap"];
  try {
    run("terraform", terraformInitArgs(env, "hono-bootstrap"), child);
    let existing = "";
    try {
      existing = run("terraform", [...prefix, "state", "list"], child);
    } catch (error) {
      if (!(error instanceof StageCommandFailure) || !error.noState) throw error;
    }
    const resources = existing
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean);
    if (resources.some((value) => !stageResources.includes(value)))
      throw new Error("Unexpected bootstrap state");
    report("bootstrap-state", { resources });
    run(
      "terraform",
      [...prefix, "plan", "-input=false", "-no-color", "-lock-timeout=5m", `-out=${plan}`],
      child,
    );
    chmodSync(plan, 0o600);
    const view = JSON.parse(run("terraform", [...prefix, "show", "-json", plan], child));
    if (!Array.isArray(view.resource_changes)) throw new Error("Bootstrap plan unavailable");
    const allowed = new Set(stageResources);
    for (const change of [...view.resource_changes, ...(view.resource_drift ?? [])]) {
      if (
        !allowed.has(change.address) ||
        !Array.isArray(change.change?.actions) ||
        change.change.actions.some((value) => !["no-op", "create", "read"].includes(value)) ||
        (change.address.startsWith("data.") &&
          change.change.actions.some((value) => !["no-op", "read"].includes(value)))
      )
        throw new Error("Bootstrap plan includes unrelated or destructive changes");
    }
    report(
      "bootstrap-plan",
      view.resource_changes.map((change) => ({
        address: change.address,
        actions: change.change.actions,
      })),
    );
    if (action === "plan")
      return {
        status: "planned",
        resources: view.resource_changes.map((change) => ({
          address: change.address,
          actions: change.change.actions,
        })),
      };
    run(
      "terraform",
      [...prefix, "apply", "-input=false", "-no-color", "-lock-timeout=5m", plan],
      child,
    );
    const bootstrap = JSON.parse(run("terraform", [...prefix, "output", "-json"], child));
    const hide = (value) => {
      if (typeof value === "string") {
        mask(value);
        if (value.startsWith("postgres")) {
          try {
            mask(decodeURIComponent(new URL(value).password));
          } catch {}
        }
      } else if (value && typeof value === "object")
        for (const item of Object.values(value)) hide(item);
    };
    hide(bootstrap);
    const configured = assemble(bootstrap, env);
    // Publish once before the migration boundary; only real registry digests enter Terraform.
    report("publish-images");
    const published = await Promise.resolve(images(configured));
    const prepared = {
      ...configured,
      TF_VAR_runner_image: published.runner,
      TF_VAR_verifier_image: published.verifier,
      TF_VAR_image_service_image: published.image,
      TF_VAR_case_images: JSON.stringify(
        Object.fromEntries(
          ["python", "java", "typescript", "ocaml", "postgresql"].map((name) => [
            name,
            published[name],
          ]),
        ),
      ),
    };
    return await activate(prepared, {
      images: () => published,
      probe: stageNamespaceReady,
      phase: report,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const action = stageIntent(process.env);
    const receipt = await launchStage(process.env, {
      action,
      report(phase, resources) {
        process.stdout.write(`${JSON.stringify({ phase, ...(resources ? { resources } : {}) })}\n`);
      },
      mask(value) {
        if (value.length >= 8)
          process.stdout.write(
            `::add-mask::${value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}\n`,
          );
      },
    });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof StageCommandFailure ? JSON.stringify({ error: "stage-command", category: error.category, resources: error.resources, diagnostics: error.diagnostics }) : "Isolated stage launch failed; sensitive output withheld"}\n`,
    );
    process.exitCode = 1;
  }
}
