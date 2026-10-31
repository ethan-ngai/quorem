/** @file stream.ts @description Bounded, reauthorized interview snapshot reads. @module interviews */
import { sql } from "drizzle-orm";
import type { ConnectionScope, Transaction } from "@quorem/database/core";
import { ApplicationError } from "../../../../application/error.ts";
import type { Principal } from "../../../../modules/identity/model.ts";
import { capabilitiesInTransaction } from "../../access/repository.ts";
import { readInterviewAccess } from "../lifecycle/access.ts";
import { prepareInterviewSnapshot } from "./snapshot.ts";
import { StreamingJsonReader } from "@quorem/questions";
import {
  evaluatedStatusBytes,
  evaluatedStatusPlan,
} from "../../judging/results/evaluated-status.ts";
import { privateStatusPage, privateStatusPlan } from "./private-status-read.ts";
import { projectedObject } from "../../judging/results/projected-stream.ts";
type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const options = { statementTimeoutMs: 5000, lockTimeoutMs: 1000 };
const encoder = new TextEncoder();
const changed = () =>
  new ApplicationError("document_changed", "Interview changed; refresh snapshot", 409);
/** Reauthorize every page; never hold a database connection during backpressure. */
export function interviewSnapshotStream(run: Run) {
  return async (actor: Principal, id: string): Promise<ReadableStream<Uint8Array>> => {
    const transact = <T>(f: (tx: Transaction) => Promise<T>) =>
      run((scope) => scope.transaction({ ...options, isolation: "repeatable read" }, f));
    const plan = await transact((tx) => prepareInterviewSnapshot(tx, actor, id));
    async function* bytes(
      kind: "examples" | "case",
      ordinal: number,
      rowVersion: string,
      revealed: boolean,
    ): AsyncGenerator<Uint8Array> {
      for (let offset = 1; ; offset += 65536) {
        const part = await transact(async (tx) => {
          const access = await readInterviewAccess(tx, actor, id, capabilitiesInTransaction);
          if (
            access.questionEpoch !== plan.epoch ||
            access.version !== plan.version ||
            access.role !== plan.role
          )
            throw changed();
          const result =
            kind === "examples"
              ? await tx.execute<{ data: Uint8Array }>(
                  sql`SELECT substring(examples FROM ${offset} FOR 65536) AS data FROM interview_public_examples WHERE session_id=${id}::uuid AND question_epoch=${plan.epoch}::uuid AND level=${ordinal} AND xmin::text=${rowVersion}`,
                )
              : await tx.execute<{ data: Uint8Array }>(
                  sql`SELECT substring(c.case_data FROM ${offset} FOR 65536) AS data FROM interview_question_private_cases c JOIN interview_members m ON m.session_id=c.session_id AND m.user_id=${actor.userId} AND m.removed_at IS NULL LEFT JOIN interview_case_visibility v ON v.session_id=c.session_id AND v.question_epoch=c.question_epoch AND v.case_id=c.case_id WHERE c.session_id=${id}::uuid AND c.question_epoch=${plan.epoch}::uuid AND c.ordinal=${ordinal} AND c.xmin::text=${rowVersion} AND (m.role='interviewer' OR v.case_id IS NOT NULL) AND (v.case_id IS NOT NULL)=${revealed}`,
                );
          if (!result.rows.length) throw changed();
          return result.rows[0].data;
        });
        if (!part.length) break;
        yield part;
        if (part.length < 65536) break;
      }
    }
    function* text(value: string): Generator<Uint8Array> {
      const data = encoder.encode(value);
      for (let offset = 0; offset < data.length; offset += 65536)
        yield data.subarray(offset, offset + 65536);
    }
    async function* content(): AsyncGenerator<Uint8Array> {
      const pattern =
        /"(__quorem_stream_[0-9a-f-]+_(?:example_\d+|cases_(?:true|false)|statuses)__)"/g;
      let offset = 0,
        match: RegExpExecArray | null;
      while ((match = pattern.exec(plan.json))) {
        const marker = plan.markers[match[1]];
        if (!marker) throw new Error("Invalid snapshot marker");
        yield* text(plan.json.slice(offset, match.index));
        if (marker.kind === "statuses") {
          if (!plan.statusPlan) throw changed();
          yield* evaluatedStatusBytes(
            run,
            { kind: "interview", sessionId: id, epoch: plan.epoch },
            plan.statusPlan,
            async (tx) => {
              const access = await readInterviewAccess(tx, actor, id, capabilitiesInTransaction);
              if (
                access.questionEpoch !== plan.epoch ||
                access.version !== plan.version ||
                access.role !== plan.role
              )
                throw changed();
            },
          );
        } else if (marker.kind === "examples")
          yield* bytes("examples", marker.level, marker.rowVersion, false);
        else {
          yield* text("[");
          let first = true;
          for (const c of marker.cases) {
            if (marker.revealedOnly && !c.revealed) continue;
            if (!first) yield* text(",");
            first = false;
            yield* text(`{"id":${JSON.stringify(c.id)},"case":`);
            const decoder = new TextDecoder("utf-8", { fatal: true });
            async function* decoded() {
              for await (const chunk of bytes("case", c.ordinal, c.rowVersion, c.revealed))
                yield decoder.decode(chunk, { stream: true });
              yield decoder.decode();
            }
            const input = new StreamingJsonReader(decoded()[Symbol.asyncIterator]());
            for await (const part of projectedObject(
              input,
              new Set(["args", "expected", "calls"]),
              true,
            ))
              yield* text(part);
            yield* text(`,"revealed":${c.revealed}`);
            if (c.status) {
              yield* text(',"status":');
              for (let offset = 0; offset < c.status.size; offset += 65536) {
                const ref = c.status;
                const part = await transact(async (tx) => {
                  const access = await readInterviewAccess(
                    tx,
                    actor,
                    id,
                    capabilitiesInTransaction,
                  );
                  const current = await privateStatusPlan(tx, id, plan.epoch);
                  if (
                    access.questionEpoch !== plan.epoch ||
                    access.version !== plan.version ||
                    access.role !== plan.role ||
                    current.digest !== plan.privateStatusPlan.digest
                  )
                    throw changed();
                  const visible = await tx.execute(
                    sql`SELECT 1 FROM interview_question_private_cases c JOIN interview_members m ON m.session_id=c.session_id AND m.user_id=${actor.userId} AND m.removed_at IS NULL LEFT JOIN interview_case_visibility v ON v.session_id=c.session_id AND v.question_epoch=c.question_epoch AND v.case_id=c.case_id WHERE c.session_id=${id}::uuid AND c.question_epoch=${plan.epoch}::uuid AND c.case_id=${c.id} AND c.xmin::text=${c.rowVersion} AND (m.role='interviewer' OR v.case_id IS NOT NULL) AND (v.case_id IS NOT NULL)=${c.revealed}`,
                  );
                  if (!visible.rows.length) throw changed();
                  return privateStatusPage(tx, ref, offset);
                });
                if (!part.length) throw changed();
                yield part;
              }
            }
            yield* text("}");
          }
          yield* text("]");
        }
        offset = pattern.lastIndex;
      }
      yield* text(plan.json.slice(offset));
    }
    async function* coalesced(): AsyncGenerator<Uint8Array> {
      let buffer = new Uint8Array(65536),
        used = 0;
      for await (const chunk of content()) {
        let offset = 0;
        while (offset < chunk.length) {
          const count = Math.min(buffer.length - used, chunk.length - offset);
          buffer.set(chunk.subarray(offset, offset + count), used);
          used += count;
          offset += count;
          if (used === buffer.length) {
            yield buffer;
            buffer = new Uint8Array(65536);
            used = 0;
          }
        }
      }
      if (used) yield buffer.subarray(0, used);
    }
    const iterator = coalesced();
    return new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          try {
            const next = await iterator.next();
            if (next.done) controller.close();
            else {
              await transact(async (tx) => {
                const access = await readInterviewAccess(tx, actor, id, capabilitiesInTransaction);
                const privateCurrent = await privateStatusPlan(tx, id, plan.epoch);
                if (privateCurrent.digest !== plan.privateStatusPlan.digest) throw changed();
                if (plan.statusPlan) {
                  const current = await evaluatedStatusPlan(tx, {
                    kind: "interview",
                    sessionId: id,
                    epoch: plan.epoch,
                  });
                  if (
                    current.count !== plan.statusPlan.count ||
                    current.digest !== plan.statusPlan.digest
                  )
                    throw changed();
                }
                if (
                  access.questionEpoch !== plan.epoch ||
                  access.version !== plan.version ||
                  access.role !== plan.role
                )
                  throw changed();
              });
              controller.enqueue(next.value);
            }
          } catch (e) {
            controller.error(e);
          }
        },
        async cancel() {
          await iterator.return(undefined);
        },
      },
      { highWaterMark: 0 },
    );
  };
}
