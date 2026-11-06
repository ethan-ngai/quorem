/** @file pending.ts @description Shared unsettled round work predicate. @module matches */
import { sql, type SQL } from "drizzle-orm";
export const reviewPending = (match: SQL) =>
  sql`EXISTS (SELECT 1 FROM submissions pending WHERE pending.match_id=${match} AND pending.state IN ('queued','running'))`;
