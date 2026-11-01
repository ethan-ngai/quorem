/** @file repository.ts @description Transactional private interview monitoring. @module interviews */
import { sql } from "drizzle-orm";
import type { ConnectionScope, Transaction } from "@quorem/database/core";
import { ApplicationError } from "../../../../application/error.ts";
import type {
  InterviewMonitoring,
  MonitoringPolicy,
} from "../../../../modules/interviews/monitoring/model.ts";
import { interviewCommandFingerprint } from "../../../../modules/interviews/question/fingerprint.ts";
import { capabilitiesInTransaction } from "../../access/repository.ts";
import { lockInterview } from "../lifecycle/access.ts";
import { operationFingerprint, priorOperation, saveOperation } from "../lifecycle/operations.ts";
type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const opts = { statementTimeoutMs: 5000, lockTimeoutMs: 1000 };
const invalid = () => new ApplicationError("invalid_input", "Invalid interview event", 400);
function normalize(policy: MonitoringPolicy): { paste?: boolean; focus?: boolean } {
  if (
    !policy ||
    typeof policy !== "object" ||
    Array.isArray(policy) ||
    Object.keys(policy).some((k) => !["paste", "focus"].includes(k)) ||
    Object.values(policy).some((v) => v !== null && typeof v !== "boolean")
  )
    throw invalid();
  return {
    ...(policy.paste == null ? {} : { paste: policy.paste }),
    ...(policy.focus == null ? {} : { focus: policy.focus }),
  };
}
export function interviewMonitoring(run: Run): InterviewMonitoring {
  const transaction = <T>(fn: (tx: Transaction) => Promise<T>) =>
    run((scope) => scope.transaction(opts, fn));
  return {
    setPolicy: async (actor, id, key, input) => {
      const policy = normalize(input),
        hash = await interviewCommandFingerprint(`${id}:monitoring`, policy);
      return transaction(async (tx) => {
        const prior = await priorOperation(tx, actor.userId, key, hash);
        const room = await lockInterview(tx, actor, id, capabilitiesInTransaction, {
          manage: true,
        });
        if (prior) return JSON.stringify({ id });
        await lockInterview(tx, actor, id, capabilitiesInTransaction, {
          manage: true,
          active: true,
        });
        if (room.host !== actor.userId)
          throw new ApplicationError(
            "forbidden",
            "Only the host can change interview monitoring",
            403,
          );
        await tx.execute(
          sql`UPDATE interviews SET monitoring=${JSON.stringify(policy)}::jsonb,version=version+1,updated_at=clock_timestamp() WHERE id=${id}::uuid`,
        );
        await saveOperation(tx, actor.userId, key, hash, id);
        return JSON.stringify({ id });
      });
    },
    report: async (actor, id, key, kind) => {
      if (kind !== "paste" && kind !== "focus") throw invalid();
      const hash = await operationFingerprint(`${id}:rule-event`, kind);
      await transaction(async (tx) => {
        const prior = await priorOperation(tx, actor.userId, key, hash);
        const room = await lockInterview(tx, actor, id, capabilitiesInTransaction, {
          active: true,
        });
        if (room.role !== "interviewee")
          throw new ApplicationError(
            "forbidden",
            "Only interviewees report monitoring events",
            403,
          );
        if (prior) return;
        const row = (
          await tx.execute<{ enabled: boolean; recent: boolean }>(
            sql`SELECT COALESCE((monitoring->>${kind})::boolean,true) AS enabled,EXISTS(SELECT 1 FROM interview_rule_events WHERE session_id=${id}::uuid AND owner_id=${actor.userId} AND kind=${kind} AND occurred_at>clock_timestamp()-interval '2 seconds') AS recent FROM interviews WHERE id=${id}::uuid`,
          )
        ).rows[0];
        if (row.enabled && !row.recent) {
          await tx.execute(
            sql`INSERT INTO interview_rule_events(id,session_id,owner_id,kind) VALUES(${crypto.randomUUID()}::uuid,${id}::uuid,${actor.userId},${kind})`,
          );
          await tx.execute(
            sql`DELETE FROM interview_rule_events WHERE session_id=${id}::uuid AND id NOT IN(SELECT id FROM interview_rule_events WHERE session_id=${id}::uuid ORDER BY occurred_at DESC,id DESC LIMIT 100)`,
          );
          await tx.execute(
            sql`UPDATE interviews SET version=version+1,updated_at=clock_timestamp() WHERE id=${id}::uuid`,
          );
        }
        await saveOperation(tx, actor.userId, key, hash, id);
      });
    },
  };
}
