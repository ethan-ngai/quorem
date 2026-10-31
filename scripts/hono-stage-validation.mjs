/** Local deployment contracts; owns only its disposable PostgreSQL container. */
import { execFileSync, spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import { randomUUID } from "node:crypto";

const name = `quorem-stage-contracts-${randomUUID()}`;
let container, failure;
try {
  container = execFileSync(
    "docker",
    [
      "run",
      "--detach",
      "--rm",
      "--name",
      name,
      "--publish",
      "127.0.0.1:55598:5432",
      "--env",
      "POSTGRES_USER=fixture",
      "--env",
      "POSTGRES_PASSWORD=fixture",
      "--env",
      "POSTGRES_DB=quorem_hono_stage",
      "postgres:17.6-alpine",
      "-c",
      "max_prepared_transactions=10",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      spawnSync(
        "docker",
        ["exec", container, "pg_isready", "-U", "fixture", "-d", "quorem_hono_stage"],
        { stdio: "ignore" },
      ).status === 0
    ) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("Disposable stage-contract database unavailable");
  // Recovery cases terminate other sessions; files must share this fixture sequentially.
  execFileSync(
    process.execPath,
    [
      "--test",
      "--test-concurrency=1",
      ...globSync("scripts/hono-stage*.test.mjs").sort(),
      "scripts/hono-remote-validation.test.mjs",
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        QUOREM_STAGE_RECOVERY_TEST_DATABASE_URL:
          "postgres://fixture:fixture@127.0.0.1:55598/quorem_hono_stage?sslmode=disable",
      },
    },
  );
} catch (error) {
  failure = error;
}
// A failed bind may leave a stopped container; the generated name is exclusively ours.
const result = spawnSync("docker", ["rm", "--force", container || name], { encoding: "utf8" });
if (result.status !== 0 && !result.stderr?.includes("No such container"))
  throw new Error("Stage-contract container cleanup unconfirmed", { cause: failure });
if (failure) throw failure;
