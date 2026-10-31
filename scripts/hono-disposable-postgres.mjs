/** Own a uniquely named PostgreSQL container and confirm cleanup on failure or interruption. */
import { execFile, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

const execute = promisify(execFile);
export async function withDisposablePostgres({ prefix, port, database }, action) {
  if (
    !/^[a-z0-9-]+$/.test(prefix) ||
    !/^quorem_hono_[a-z0-9_]+$/.test(database) ||
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535
  )
    throw new Error("Invalid disposable database configuration");
  const name = `${prefix}-${randomUUID()}`;
  let interrupted, testProcess, failure, cleanupFailure;
  const onSignal = (signal) => {
    interrupted ??= signal;
    if (testProcess?.pid) {
      try {
        process.kill(-testProcess.pid, "SIGTERM");
      } catch {
        testProcess.kill("SIGTERM");
      }
    }
  };
  const onInt = () => onSignal("SIGINT"),
    onTerm = () => onSignal("SIGTERM");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  const run = (command, args, options = {}) =>
    new Promise((resolve, reject) => {
      if (interrupted) return reject(new Error("Validation interrupted"));
      testProcess = spawn(command, args, { ...options, detached: true, stdio: "inherit" });
      testProcess.once("error", reject);
      testProcess.once("exit", (code, signal) => {
        testProcess = undefined;
        if (code === 0 && !interrupted) resolve();
        else reject(new Error(`Validation failed (${signal ?? code})`));
      });
    });
  try {
    await execute(
      "docker",
      [
        "run",
        "--detach",
        "--rm",
        "--name",
        name,
        "--publish",
        `127.0.0.1:${port}:5432`,
        "--env",
        "POSTGRES_USER=fixture",
        "--env",
        "POSTGRES_PASSWORD=fixture",
        "--env",
        `POSTGRES_DB=${database}`,
        "postgres:17.6-alpine",
        "-c",
        "max_prepared_transactions=10",
      ],
      { timeout: 120000 },
    );
    if (interrupted) throw new Error("Validation interrupted");
    let ready = false;
    for (let attempt = 0; attempt < 100 && !interrupted; attempt++) {
      if (
        spawnSync(
          "docker",
          ["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "fixture", "-d", database],
          {
            stdio: "ignore",
          },
        ).status === 0
      ) {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error("Disposable PostgreSQL unavailable");
    await action({
      url: `postgres://fixture:fixture@127.0.0.1:${port}/${database}?sslmode=disable`,
      run,
    });
  } catch (error) {
    failure = error;
  } finally {
    const result = spawnSync("docker", ["rm", "--force", name], { encoding: "utf8" });
    const absent = spawnSync("docker", ["inspect", name], { encoding: "utf8" });
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
    if (
      (result.status !== 0 && !/no such container/i.test(result.stderr ?? "")) ||
      absent.status !== 1 ||
      !/no such object/i.test(absent.stderr ?? "")
    )
      cleanupFailure = new Error("Disposable PostgreSQL cleanup unconfirmed", { cause: failure });
  }
  if (cleanupFailure) throw cleanupFailure;
  if (failure) throw failure;
  if (interrupted) throw new Error("Validation interrupted");
}
