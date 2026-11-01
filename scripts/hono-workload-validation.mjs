/** Required actor and real runtime workload tests; fixture databases are disposable. */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { withDisposablePostgres } from "./hono-disposable-postgres.mjs";

const script = fileURLToPath(import.meta.url);
const required = new Map([
  ["apps/api/src/runtime/composition/fixtures/staged-actor.test.ts", 4],
  ["scripts/hono-workload.integration.test.mjs", 1],
]);
if (process.argv[2] === "--required-node") {
  const file = process.argv[3],
    minimum = required.get(file);
  if (!minimum || process.argv.length !== 4) throw new Error("Invalid required test");
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--test", "--test-reporter=tap", file],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  const tests = Number(result.stdout?.match(/^# tests (\d+)$/m)?.[1]);
  const passed = Number(result.stdout?.match(/^# pass (\d+)$/m)?.[1]);
  const skipped = Number(result.stdout?.match(/^# skipped (\d+)$/m)?.[1]);
  if (
    result.status !== 0 ||
    !Number.isSafeInteger(tests) ||
    tests < minimum ||
    passed !== tests ||
    skipped !== 0
  )
    throw new Error("Required workload tests failed, skipped or missing");
} else {
  if (process.argv.length !== 2) throw new Error("Invalid validation arguments");
  await withDisposablePostgres(
    {
      prefix: "quorem-workload-actor",
      port: 55709,
      database: "quorem_hono_stage_fixture_test",
      automaticPort: Boolean(process.env.CI),
    },
    async (main) => {
      await withDisposablePostgres(
        {
          prefix: "quorem-workload-empty",
          automaticPort: Boolean(process.env.CI),
          port: 55710,
          database: "quorem_hono_stage_fixture_test",
        },
        async (empty) => {
          await main.run(
            process.execPath,
            [
              script,
              "--required-node",
              "apps/api/src/runtime/composition/fixtures/staged-actor.test.ts",
            ],
            {
              env: {
                ...process.env,
                QUOREM_STAGE_FIXTURE_TEST_DATABASE_URL: main.url,
                QUOREM_STAGE_FIXTURE_EMPTY_DATABASE_URL: empty.url,
              },
            },
          );
        },
      );
      await main.run(
        process.execPath,
        [script, "--required-node", "scripts/hono-workload.integration.test.mjs"],
        { env: { ...process.env, QUOREM_TEST_DOCKER_SOCKET: "/var/run/docker.sock" } },
      );
    },
  );
}
