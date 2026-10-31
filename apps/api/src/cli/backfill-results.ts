/** @file backfill-results.ts @description Privileged bounded result and status normalization. @module cli */
import { runBackfill, ResultBackfillFailure } from "./operator-backfill.ts";

if (import.meta.main) {
  try {
    const result = await runBackfill([...process.argv.slice(2), "--results"]);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.dryRun && !result.complete) process.exitCode = 2;
  } catch (error) {
    if (error instanceof ResultBackfillFailure)
      process.stdout.write(`${JSON.stringify(error.progress)}\n`);
    console.error("Result backfill failed");
    process.exitCode = 1;
  }
}
