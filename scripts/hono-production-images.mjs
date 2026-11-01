/** @file hono-production-images.mjs @description Reuse verified immutable runtime images. @module deployment */
import { runStageCommand } from "./hono-stage-command.mjs";
const source = "333e4c79b06f9b074b13ae4891a6df65f32bcc8f";
const runId = "41285899439";
export function productionImages(env) {
  const run = JSON.parse(
    runStageCommand("gh", ["api", `repos/ethan-ngai/quorem/actions/runs/${runId}`], env),
  );
  if (
    run.conclusion !== "success" ||
    run.head_sha !== source ||
    run.path !== ".github/workflows/hono-stage-deploy.yaml"
  )
    throw new Error("Validated runtime provenance mismatch");
  runStageCommand(
    "git",
    [
      "diff",
      "--exit-code",
      source,
      "--",
      "pnpm-lock.yaml",
      "apps/runner/src",
      "apps/runner/python",
      "apps/runner/java",
      "apps/runner/typescript",
      "apps/runner/ocaml",
      "apps/runner/postgres",
      "packages/execution",
      "packages/questions",
      "packages/database",
      "deploy/hono/Dockerfile.runner",
      "deploy/hono/services/start.mjs",
      "deploy/hono/services/Dockerfile.image",
      "apps/auth/src/image-service-main.ts",
      "apps/auth/src/image-service.ts",
      "apps/auth/src/adapters/sharp-image.ts",
    ],
    env,
  );
  const logs = runStageCommand("gh", ["run", "view", runId, "--log"], env);
  let receipt;
  for (const line of logs.split("\n")) {
    const start = line.indexOf('{"release":');
    if (start >= 0) {
      try {
        const value = JSON.parse(line.slice(start));
        if (value.release === source && value.images) receipt = value;
      } catch {}
    }
  }
  const images = {};
  for (const role of [
    "runner",
    "verifier",
    "python",
    "java",
    "typescript",
    "ocaml",
    "postgresql",
    "image",
  ]) {
    const value = receipt?.images?.[role];
    if (
      typeof value !== "string" ||
      !value.startsWith(`registry.cloudflare.com/${env.CLOUDFLARE_ACCOUNT_ID}/`) ||
      !/@sha256:[a-f0-9]{64}$/.test(value)
    )
      throw new Error("Validated runtime image missing");
    images[role] = value;
  }
  const repository = `registry.cloudflare.com/${env.CLOUDFLARE_ACCOUNT_ID}/quorem-hono-production-mail`;
  const tag = `${repository}:${env.GITHUB_SHA}`;
  runStageCommand(
    "docker",
    ["build", "-f", "deploy/hono/services/Dockerfile.mail", "-t", tag, "."],
    env,
  );
  runStageCommand("vp", ["-C", "apps/api", "exec", "wrangler", "containers", "push", tag], env);
  const digests = JSON.parse(
    runStageCommand("docker", ["image", "inspect", "--format", "{{json .RepoDigests}}", tag], env),
  );
  const match = digests.filter(
    (value) => value.startsWith(`${repository}@sha256:`) && /[a-f0-9]{64}$/.test(value),
  );
  if (match.length !== 1) throw new Error("Mail image digest missing");
  return { ...images, mail: match[0] };
}
