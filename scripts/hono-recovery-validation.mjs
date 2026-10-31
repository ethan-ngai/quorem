/** Required local recovery contracts; all fixtures are disposable and all tests must run. */
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { withDisposablePostgres } from "./hono-disposable-postgres.mjs";

const script = fileURLToPath(import.meta.url);
function command(program, args) {
  const result = spawnSync(program, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error("Required recovery validation failed");
  return result.stdout;
}
if (process.argv[2] === "--required-node") {
  const allowed = new Map([
    ["apps/api/src/cli/migration-baseline.test.ts", 2],
    ["packages/database/src/migration-checksums.test.ts", 1],
  ]);
  const file = process.argv[3],
    expected = allowed.get(file);
  if (!expected || process.argv.length !== 4) throw new Error("Invalid required test");
  const output = command(process.execPath, [
    "--experimental-strip-types",
    "--test",
    "--test-reporter=tap",
    file,
  ]);
  const tests = Number(output.match(/^# tests (\d+)$/m)?.[1]);
  const passed = Number(output.match(/^# pass (\d+)$/m)?.[1]);
  const skipped = Number(output.match(/^# skipped (\d+)$/m)?.[1]);
  if (!Number.isSafeInteger(tests) || tests < expected || passed !== tests || skipped !== 0)
    throw new Error("Required tests were skipped or missing");
} else {
  if (process.argv.length !== 2) throw new Error("Invalid validation arguments");
  command(process.execPath, ["scripts/hono-profile-cutover-validation.mjs"]);
  const directory = await mkdtemp(join(tmpdir(), "quorem-recovery-reports-"));
  try {
    for (const [config, minimum] of [
      ["vitest.services.config.ts", 4],
      ["vitest.runner-control.config.ts", 1],
      ["vitest.case-control.workers.config.ts", 1],
    ]) {
      const output = join(directory, `${config}.json`);
      command("vp", [
        "-C",
        "apps/api",
        "exec",
        "vitest",
        "run",
        "--config",
        `src/runtime/composition/${config}`,
        "--reporter=json",
        `--outputFile=${output}`,
      ]);
      const report = JSON.parse(await readFile(output, "utf8"));
      if (
        !report.success ||
        report.numTotalTests < minimum ||
        report.numPassedTests !== report.numTotalTests ||
        report.numPendingTests !== 0 ||
        report.numTodoTests !== 0
      )
        throw new Error("Required workerd tests were skipped or missing");
      process.stdout.write(`${config}: ${report.numPassedTests} passed, zero skipped\n`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  for (const fixture of [
    {
      prefix: "quorem-baseline-validation",
      port: 55707,
      database: "quorem_hono_migration_baseline_test",
      env: "QUOREM_MIGRATION_BASELINE_TEST_URL",
      test: "apps/api/src/cli/migration-baseline.test.ts",
    },
    {
      prefix: "quorem-checksum-validation",
      port: 55603,
      database: "quorem_hono_migration_checksum_test",
      env: "QUOREM_MIGRATION_CHECKSUM_TEST_URL",
      test: "packages/database/src/migration-checksums.test.ts",
    },
  ])
    await withDisposablePostgres(fixture, async ({ url, run }) =>
      run(process.execPath, [script, "--required-node", fixture.test], {
        env: { ...process.env, [fixture.env]: url },
      }),
    );
}
