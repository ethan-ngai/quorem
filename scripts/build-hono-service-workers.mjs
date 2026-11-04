/** Bundle the private Workers before Terraform reads their upload modules. */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));
for (const role of ["runner", "verifier"]) {
  const result = spawnSync(
    "vp",
    [
      "-C",
      "apps/api",
      "exec",
      "wrangler",
      "deploy",
      "--dry-run",
      "--config",
      path(`../deploy/hono/services/wrangler.${role}.jsonc`),
      "--outdir",
      path("../deploy/hono/services/dist/"),
    ],
    { cwd: path("../"), stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
