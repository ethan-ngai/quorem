/** @file backfill-interview-cases.ts @description Bounded privileged interview sidecar repair. @module cli */
import { runBackfill } from "./operator-backfill.ts";
export const backfillInterviewCases = runBackfill;
if (import.meta.main)
  try {
    const result = await backfillInterviewCases(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.dryRun && !result.complete) process.exitCode = 2;
  } catch (error) {
    const failure = error as {
      code?: string;
      cause?: { code?: string; table?: string; column?: string; constraint?: string };
      stack?: string;
      message?: string;
      migrationShape?: unknown;
    };
    const cause = failure.cause ?? failure;
    const identifier = (value: unknown) =>
      typeof value === "string" && /^[a-z_]{1,80}$/.test(value) ? value : undefined;
    console.error(
      JSON.stringify({
        error: "backfill-failed",
        reason: [
          "Invalid legacy stage suites",
          "Unsupported legacy stage count",
          "Legacy fixture shape conflict",
          "Conflicting snapshot input",
          "Conflicting snapshot cases",
          "Private case conflict",
          "Private case set conflict",
          "Public example set conflict",
          "Snapshot changed",
        ].includes(failure.message ?? "")
          ? failure.message
          : undefined,
        shape: failure.migrationShape,
        code: /^[A-Z0-9]{5}$/.test(cause.code ?? "") ? cause.code : undefined,
        table: identifier("table" in cause ? cause.table : undefined),
        column: identifier("column" in cause ? cause.column : undefined),
        constraint: identifier("constraint" in cause ? cause.constraint : undefined),
        frames: failure.stack
          ?.split("\n")
          .slice(1, 6)
          .map((line) => line.match(/at ([A-Za-z0-9_.]+)/)?.[1])
          .filter(Boolean),
      }),
    );
    console.error("Interview sidecar backfill failed");
    process.exitCode = 1;
  }
