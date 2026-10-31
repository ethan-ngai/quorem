import { localFenceRoot } from "./fence.ts";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const [root, namespace, daemon, socket, attempt, mode] = process.argv.slice(2);
const owner = await localFenceRoot(root, namespace, daemon),
  fence = { attemptId: attempt, sandboxScope: owner.scope };
const lock = await owner.acquire(fence, AbortSignal.timeout(10000));
if (mode === "check") {
  try {
    await lock.assertOpen();
    process.exitCode = 1;
  } catch {
    process.stdout.write("terminated\n");
  } finally {
    await lock.release();
  }
} else {
  process.stdout.write("locked\n");
  if (mode === "hold") {
    process.stdin.resume();
    await new Promise(() => {});
  }
  await new Promise((resolve) => process.stdin.once("data", resolve));
  process.stdin.destroy();
  await lock.assertOpen();
  const scope = createHash("sha256").update(owner.scope).digest("hex");
  const id = execFileSync(
    "docker",
    [
      "--config",
      "/nonexistent",
      "--host",
      `unix://${socket}`,
      "create",
      "-i",
      "--label",
      `quorem.scope=${scope}`,
      "--label",
      `quorem.attempt=${attempt}`,
      "quorem-python:local",
    ],
    { encoding: "utf8" },
  ).trim();
  process.stdout.write("created\n");
  execFileSync("docker", [
    "--config",
    "/nonexistent",
    "--host",
    `unix://${socket}`,
    "rm",
    "-f",
    "-v",
    id,
  ]);
  await lock.release();
}
