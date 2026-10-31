/** Release validation resets only the guarded disposable database and refuses skipped tests. */
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapRuntimeFixture } from "./fixture.ts";
import { assertRuntimeTestDatabase } from "./test-database.ts";

const database = process.env.QUOREM_RUNTIME_TEST_URL;
const socket = process.env.QUOREM_TEST_DOCKER_SOCKET;
let child;
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    interrupted = true;
    if (child?.pid && process.platform !== "win32") {
      try {
        process.kill(-child.pid, signal);
      } catch {
        child.kill(signal);
      }
    } else child?.kill(signal);
  });
function requireCommand(command, args) {
  const result = spawnSync(command, args, { stdio: "ignore" });
  if (result.status !== 0) throw new Error("Required validation dependency unavailable");
}
async function run(command, args) {
  if (interrupted) throw new Error("Validation interrupted");
  child = spawn(command, args, {
    stdio: "inherit",
    env: process.env,
    detached: process.platform !== "win32",
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (status, signal) => resolve(signal ? 1 : status));
  });
  child = undefined;
  if (code !== 0 || interrupted) throw new Error("Validation suite failed");
}
async function suite(config, report) {
  await run("vp", [
    "exec",
    "vitest",
    "run",
    "--config",
    config,
    "--reporter=default",
    "--reporter=json",
    `--outputFile.json=${report}`,
  ]);
  const summary = JSON.parse(await readFile(report, "utf8"));
  if (
    !summary.success ||
    !Number.isSafeInteger(summary.numTotalTests) ||
    summary.numTotalTests < 1 ||
    summary.numPendingTests !== 0 ||
    summary.numTodoTests !== 0
  )
    throw new Error("Validation suite skipped required tests");
}
let cleanup;
let temporary;
try {
  if (!database) throw new Error("Disposable runtime database required");
  assertRuntimeTestDatabase(database);
  if (!socket?.startsWith("/") || !(await stat(socket)).isSocket())
    throw new Error("Docker socket required");
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw new Error("Node 24 or later required");
  requireCommand("docker", ["--config", "/nonexistent", "--host", `unix://${socket}`, "info"]);
  requireCommand("docker", [
    "--config",
    "/nonexistent",
    "--host",
    `unix://${socket}`,
    "image",
    "inspect",
    "quorem-python:local",
  ]);
  requireCommand("vp", ["exec", "wrangler", "--version"]);
  temporary = await mkdtemp(join(tmpdir(), "quorem-runtime-validation-"));
  await run(process.execPath, ["--test", "src/runtime/composition/fixture.test.ts"]);
  cleanup = await bootstrapRuntimeFixture(database);
  await suite("src/runtime/composition/vitest.config.ts", join(temporary, "node.json"));
  await suite("src/runtime/composition/vitest.workers.config.ts", join(temporary, "worker.json"));
  process.stdout.write("Runtime release validation passed.\n");
} catch {
  console.error("Runtime release validation failed; check prerequisites and test output.");
  process.exitCode = 1;
} finally {
  try {
    if (cleanup) await cleanup();
  } catch {
    console.error("Runtime fixture cleanup failed.");
    process.exitCode = 1;
  }
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
