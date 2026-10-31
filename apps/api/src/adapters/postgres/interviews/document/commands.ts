/** @file commands.ts @description Transactional interview document operations. @module interviews */
import { sql } from "drizzle-orm";
import type { ConnectionScope, Transaction } from "@quorem/database/core";
import { ApplicationError } from "../../../../application/error.ts";
import type {
  InterviewDocuments,
  DocumentPush,
} from "../../../../modules/interviews/document/model.ts";
import { applyDocumentChanges } from "../../../../modules/interviews/document/changes.ts";
import { interviewCommandFingerprint } from "../../../../modules/interviews/question/fingerprint.ts";
import { capabilitiesInTransaction } from "../../access/repository.ts";
import { lockInterview } from "../lifecycle/access.ts";
import { markRawDocumentChanges } from "../../problems/case-literals.ts";
import { priorOperation, saveOperation } from "../lifecycle/operations.ts";
type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const options = { statementTimeoutMs: 5000, lockTimeoutMs: 1000 };
const invalid = (message: string) => new ApplicationError("invalid_input", message, 400);
const changed = () =>
  new ApplicationError("document_changed", "Question changed; open its current document", 409);
const validVersion = (v: number) => Number.isSafeInteger(v) && v >= 0;
function validate(batch: DocumentPush) {
  if (
    !batch ||
    typeof batch.epoch !== "string" ||
    !validVersion(batch.version) ||
    !Array.isArray(batch.updates) ||
    batch.updates.length < 1 ||
    batch.updates.length > 32 ||
    !Number.isSafeInteger(batch.version + batch.updates.length)
  )
    throw invalid("Provide 1-32 document updates");
  for (const u of batch.updates)
    if (
      !u ||
      typeof u.clientID !== "string" ||
      !u.clientID.trim() ||
      new TextEncoder().encode(u.clientID).length > 128 ||
      u.changes === undefined
    )
      throw invalid("Invalid editor update");
}
async function state(tx: Transaction, id: string) {
  const row = (
    await tx.execute<{ source: string; version: string; epoch: string }>(
      sql`SELECT source,document_version::text AS version,document_epoch::text AS epoch FROM interviews WHERE id=${id}::uuid`,
    )
  ).rows[0];
  return { source: row.source, version: Number(row.version), epoch: row.epoch };
}
export function interviewDocumentCommands(run: Run): InterviewDocuments {
  const transaction = <T>(fn: (tx: Transaction) => Promise<T>) =>
    run((scope) => scope.transaction(options, fn));
  return {
    read: (actor, id) =>
      transaction(async (tx) => {
        await lockInterview(tx, actor, id, capabilitiesInTransaction);
        return state(tx, id);
      }),
    pull: (actor, id, epoch, version) =>
      transaction(async (tx) => {
        await lockInterview(tx, actor, id, capabilitiesInTransaction);
        const current = await state(tx, id);
        if (epoch !== current.epoch) throw changed();
        if (!validVersion(version) || version > current.version)
          throw invalid("Invalid document version");
        const rows = (
          await tx.execute<{ clientID: string; changes: unknown }>(
            sql`SELECT "clientID",changes FROM (SELECT client_id AS "clientID",changes,version,row_number() OVER (ORDER BY version) AS n,sum(octet_length(changes::text)+octet_length(client_id)*6+128) OVER (ORDER BY version) AS bytes FROM interview_updates WHERE session_id=${id}::uuid AND epoch=${epoch}::uuid AND version>${version}) page WHERE n<=256 AND (bytes<=245760 OR n=1) ORDER BY version`,
          )
        ).rows;
        return { epoch, version: version + rows.length, updates: rows };
      }),
    push: async (actor, id, key, batch, rawBody) => {
      validate(batch);
      const updates = batch.updates.map((u) => ({ clientID: u.clientID, changes: u.changes }));
      let marks: Map<string, string> | undefined;
      if (rawBody !== undefined) {
        try {
          if (
            new TextEncoder().encode(rawBody).length > 256 * 1024 ||
            JSON.stringify(JSON.parse(rawBody)) !== JSON.stringify(batch)
          )
            throw invalid("Invalid document request");
          marks = markRawDocumentChanges(rawBody, updates);
        } catch {
          throw invalid("Invalid document request");
        }
      }
      const hash = await interviewCommandFingerprint(
        `${id}:updates`,
        {
          version: batch.version,
          epoch: batch.epoch,
          updates,
        },
        marks,
      );
      return transaction(async (tx) => {
        const prior = await priorOperation(tx, actor.userId, key, hash);
        await lockInterview(tx, actor, id, capabilitiesInTransaction, { active: true });
        const result = {
          epoch: batch.epoch,
          version: batch.version + batch.updates.length,
          updates: batch.updates,
        };
        if (prior) return result;
        const current = await state(tx, id);
        if (batch.epoch !== current.epoch) throw changed();
        if (batch.version !== current.version)
          throw new ApplicationError("stale_version", "Pull document updates and retry", 409);
        let source = current.source;
        for (const [i, update] of batch.updates.entries()) {
          source = applyDocumentChanges(source, update.changes);
          await tx.execute(
            sql`INSERT INTO interview_updates(session_id,epoch,version,client_id,changes) VALUES(${id}::uuid,${batch.epoch}::uuid,${batch.version + i + 1},${update.clientID},${JSON.stringify(update.changes)}::jsonb)`,
          );
        }
        await tx.execute(
          sql`UPDATE interviews SET source=${source},document_version=${result.version},version=version+1,updated_at=clock_timestamp() WHERE id=${id}::uuid`,
        );
        await saveOperation(tx, actor.userId, key, hash, id);
        return result;
      });
    },
  };
}
