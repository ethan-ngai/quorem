/** @file run-workerd.mjs @description Start the disposable verifier fixture for the native Worker suite. */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
const fixture = fileURLToPath(new URL("./verification-test-server.ts", import.meta.url));
const api = fileURLToPath(new URL("../../../../../", import.meta.url));
const server = spawn(process.execPath, [fixture], {
  cwd: api,
  env: process.env,
  stdio: ["ignore", "pipe", "inherit"],
});
let runner;
try {
  const lines = createInterface({ input: server.stdout });
  const first = await Promise.race([
    once(lines, "line").then(([line]) => line),
    once(server, "exit").then(() => {
      throw new Error("Verification fixture unavailable");
    }),
  ]);
  const data = JSON.parse(first);
  if (!Number.isInteger(data.port) || typeof data.key !== "string")
    throw new Error("Invalid verification fixture");
  runner = spawn(
    "vp",
    [
      "exec",
      "vitest",
      "run",
      "--config",
      "src/adapters/postgres/judging/worker/vitest.workers.config.ts",
    ],
    {
      cwd: api,
      env: {
        ...process.env,
        QUOREM_VERIFIER_ORIGIN: `http://127.0.0.1:${data.port}`,
        QUOREM_VERIFIER_PUBLIC_KEY: data.key,
      },
      stdio: "inherit",
    },
  );
  const [code, signal] = await once(runner, "exit");
  process.exitCode = signal || code !== 0 ? 1 : 0;
} finally {
  runner?.kill();
  server.kill("SIGTERM");
  if (server.exitCode === null) await once(server, "exit");
}
