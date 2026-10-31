/** Build and publish images for one exact revision, returning only registry digests. */
import { spawnSync } from "node:child_process";

export function publishImages(env, run = spawnSync) {
  const account = env.CLOUDFLARE_ACCOUNT_ID,
    revision = env.HONO_RELEASE_SHA;
  if (
    !/^[a-f0-9]{32}$/.test(account ?? "") ||
    !/^[a-f0-9]{40}$/.test(revision ?? "") ||
    revision !== env.GITHUB_SHA ||
    env.GITHUB_REF !== "refs/heads/feat/hono-migration"
  )
    throw new Error("Invalid staged image revision");
  const common = Object.fromEntries(
    ["PATH", "HOME", "USER", "TMPDIR", "DOCKER_HOST", "DOCKER_CONFIG", "CI", "NODE_EXTRA_CA_CERTS"]
      .filter((key) => env[key] !== undefined)
      .map((key) => [key, env[key]]),
  );
  const call = (cmd, args) => {
    const childEnv =
      cmd === "vp"
        ? {
            ...common,
            CLOUDFLARE_ACCOUNT_ID: account,
            CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN,
          }
        : common;
    const result = run(cmd, args, {
      env: childEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error || result.status !== 0)
      throw new Error("Staged image operation failed; output withheld");
    return result.stdout ?? "";
  };
  for (const role of ["runner", "verifier"])
    call("docker", [
      "build",
      "-f",
      "deploy/hono/Dockerfile.runner",
      "--target",
      role,
      "-t",
      `quorem-hono-${role}:stage-build`,
      ".",
    ]);
  call("python3", ["scripts/build-judge-images.py"]);
  const result = {};
  for (const role of [
    "runner",
    "verifier",
    "python",
    "java",
    "typescript",
    "ocaml",
    "postgresql",
  ]) {
    const source = ["runner", "verifier"].includes(role)
      ? `quorem-hono-${role}:stage-build`
      : `quorem-case-${role}:local`;
    const repository = `registry.cloudflare.com/${account}/quorem-hono-stage-${role}`;
    const tag = `${repository}:${revision}`;
    call("docker", ["tag", source, tag]);
    call("vp", ["-C", "apps/api", "exec", "wrangler", "containers", "push", tag]);
    let digests;
    try {
      digests = JSON.parse(
        call("docker", ["image", "inspect", "--format", "{{json .RepoDigests}}", tag]),
      );
    } catch {
      throw new Error("Invalid staged image digest");
    }
    const matches = Array.isArray(digests)
      ? digests.filter(
          (value) =>
            typeof value === "string" &&
            value.startsWith(`${repository}@sha256:`) &&
            /^[a-f0-9]{64}$/.test(value.slice(-64)),
        )
      : [];
    if (matches.length !== 1 || matches[0].length !== repository.length + 72)
      throw new Error("Staged image digest missing or ambiguous");
    result[role] = matches[0];
  }
  return result;
}
