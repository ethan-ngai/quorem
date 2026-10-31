/** @file backfill-interview-cases.ts @description Bounded privileged interview sidecar repair. @module cli */
import { runBackfill } from "./operator-backfill.ts";
export const backfillInterviewCases = runBackfill;
if (import.meta.main)
  try {
    const result = await backfillInterviewCases(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.dryRun && !result.complete) process.exitCode = 2;
  } catch {
    console.error("Interview sidecar backfill failed");
    process.exitCode = 1;
  }
