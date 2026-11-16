/** @file limits.ts @description Resolve the CPU budget frozen at admission. @module judging */
import { sql, type SQL } from "drizzle-orm";

/** @returns Effective limits for the execution job aliased as j. */
export function workspaceExecutionLimits(published: SQL): SQL {
  return sql`CASE WHEN j.case_cpu_ms IS NULL THEN ${published}
    ELSE jsonb_set(${published}, '{wallTimeMs}', to_jsonb(j.case_cpu_ms)) END`;
}
