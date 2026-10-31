/** @file active.ts @description Epoch-fenced active interview input identity. @module interviews */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
/** Caller owns the locked question mutation and has already sealed its snapshot index. */
export async function setActiveRunnerFixture(
  tx: Transaction,
  sessionId: string,
  questionEpoch: string,
  fixtureId: Uint8Array,
): Promise<void> {
  await tx.execute(
    sql`INSERT INTO interview_active_runner_inputs(session_id,question_epoch,fixture_id) VALUES(${sessionId}::uuid,${questionEpoch}::uuid,${fixtureId}::bytea) ON CONFLICT(session_id) DO UPDATE SET question_epoch=EXCLUDED.question_epoch,fixture_id=EXCLUDED.fixture_id`,
  );
}
