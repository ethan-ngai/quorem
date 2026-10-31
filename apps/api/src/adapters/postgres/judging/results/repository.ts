/** @file repository.ts @description Authorized submission reads and atomic cancellation. @module judging */
import { sql } from "drizzle-orm";
import type { ConnectionScope, Transaction } from "@quorem/database/core";
import {
  JsonNumber,
  parseLosslessJson,
  stringifyLosslessJson,
  type JsonValue,
} from "@quorem/questions";
import { ApplicationError } from "../../../../application/error.ts";
import type { Principal } from "../../../../modules/identity/model.ts";
import type { SubmissionSnapshots } from "../../../../modules/judging/results/model.ts";
import { lookupGuestInTransaction } from "../../identity/guest.ts";
import { encode, object, publicResult } from "./projection.ts";
import { jsonStream } from "../../../../modules/judging/results/stream.ts";
import { resultCase } from "./projection.ts";
import { projectedObject } from "./projected-stream.ts";
import { StreamingJsonReader } from "@quorem/questions";
import { interviewAccess } from "./interview.ts";
type Run = <T>(fn: (scope: Pick<ConnectionScope, "transaction">) => Promise<T>) => Promise<T>;
type Row = {
  id: string;
  workspace: string | null;
  kind: string;
  state: string;
  source_hash: string;
  admitted: string;
  updated: string;
  custom: boolean;
  interview: string | null;
  match: string | null;
  result: Uint8Array | null;
};
const options = { statementTimeoutMs: 5000, lockTimeoutMs: 1000 };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const missing = () => new ApplicationError("not_found", "Submission not found", 404);
async function identity(tx: Transaction, who: Principal): Promise<void> {
  const user = await tx.execute(
    sql`SELECT id FROM users WHERE id=${who.userId} AND NOT disabled FOR SHARE`,
  );
  if (!user.rows.length) throw missing();
  if (who.kind === "guest") {
    const actual = await lookupGuestInTransaction(tx, who.scope.kind, who.sessionId);
    if (
      !actual ||
      actual.userId !== who.userId ||
      actual.scope.kind !== who.scope.kind ||
      (actual.scope.kind === "match" ? actual.scope.matchId : actual.scope.interviewId) !==
        (who.scope.kind === "match" ? who.scope.matchId : who.scope.interviewId)
    )
      throw missing();
  }
}
async function load(tx: Transaction, id: string, owner?: string, lock = false): Promise<Row> {
  if (!uuid.test(id)) throw missing();
  const result = await tx.execute<Row>(
    sql`SELECT s.id::text,s.workspace_id::text AS workspace,s.kind,s.state,s.source_hash,to_char(s.admitted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS admitted,to_char(s.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated,s.custom_run AS custom,s.interview_id::text AS interview,s.match_id::text AS match,CASE WHEN s.result IS NULL THEN NULL ELSE convert_to('{}','UTF8') END AS result FROM submissions s WHERE s.id=${id}::uuid ${owner === undefined ? sql`` : sql`AND s.owner_id=${owner}`} ${lock ? sql`FOR UPDATE OF s` : sql``}`,
  );
  const row = result.rows[0];
  if (!row) throw missing();
  return row;
}
function assertScope(who: Principal, row: Row): void {
  if (who.kind !== "guest") return;
  if (
    who.scope.kind === "match"
      ? row.match !== who.scope.matchId
      : row.interview !== who.scope.interviewId
  )
    throw missing();
}
function snapshot(row: Row, hideInterview: boolean): { [key: string]: JsonValue } {
  return {
    id: row.id,
    ...(row.workspace ? { workspaceId: row.workspace } : {}),
    kind: row.kind,
    state: row.state,
    sourceHash: row.source_hash,
    admittedAt: row.admitted,
    updatedAt: row.updated,
    ...(row.custom ? { customRun: true } : {}),
    ...publicResult(row.result, hideInterview && row.interview !== null && row.kind === "submit"),
  };
}
export function submissionSnapshots(run: Run): SubmissionSnapshots {
  return {
    async read(who, id) {
      return streamSnapshot(run, who, id);
    },
    async interview(who, interviewId, id) {
      if (!uuid.test(interviewId)) throw missing();
      return streamSnapshot(run, who, id, interviewId);
    },
    async cancel(who, id, key) {
      if (!uuid.test(id)) throw missing();
      if (!key || new TextEncoder().encode(key).length > 128)
        throw new ApplicationError("invalid_input", "Idempotency-Key required", 400);
      return run((scope) =>
        scope.transaction(options, async (tx) => {
          await identity(tx, who);
          await tx.execute(sql`SELECT pg_advisory_xact_lock(740020)`);
          const replay = (
            await tx.execute<{ submission: string; response: string }>(
              sql`SELECT submission_id::text AS submission,response::text AS response FROM cancellation_idempotency WHERE owner_id=${who.userId} AND key=${key} AND expires_at>clock_timestamp()`,
            )
          ).rows[0];
          if (replay) {
            if (replay.submission !== id.toLowerCase())
              throw new ApplicationError(
                "idempotency_conflict",
                "Key was used for a different cancellation",
                409,
              );
            const row = await load(tx, id, who.userId);
            assertScope(who, row);
            return stringifyLosslessJson(object(parseLosslessJson(replay.response)));
          }
          const row = await load(tx, id, who.userId, true);
          assertScope(who, row);
          if (row.match && row.kind === "submit")
            throw new ApplicationError(
              "invalid_transition",
              "Match submissions cannot be cancelled",
              409,
            );
          if (row.state === "queued") {
            await tx.execute(
              sql`UPDATE execution_jobs SET finished=true,attempt_id=NULL WHERE submission_id=${id}::uuid`,
            );
            await tx.execute(
              sql`UPDATE submissions SET state='cancelled',cancel_requested=true,updated_at=clock_timestamp() WHERE id=${id}::uuid`,
            );
          } else if (row.state === "running")
            await tx.execute(
              sql`UPDATE submissions SET cancel_requested=true,updated_at=clock_timestamp() WHERE id=${id}::uuid`,
            );
          else if (row.state !== "cancelled")
            throw new ApplicationError("invalid_transition", "Execution already finished", 409);
          const response = encode(snapshot(await load(tx, id, who.userId), true));
          await tx.execute(
            sql`INSERT INTO cancellation_idempotency(owner_id,key,submission_id,response,expires_at) VALUES(${who.userId},${key},${id}::uuid,${response}::jsonb,clock_timestamp()+interval '24 hours') ON CONFLICT(owner_id,key) DO UPDATE SET submission_id=EXCLUDED.submission_id,response=EXCLUDED.response,expires_at=EXCLUDED.expires_at`,
          );
          return response;
        }),
      );
    },
  };
}

async function streamSnapshot(
  run: Run,
  who: Principal,
  id: string,
  interviewId?: string,
): Promise<ReadableStream<Uint8Array>> {
  const prepared = await run((scope) =>
    scope.transaction({ ...options, isolation: "repeatable read" }, async (tx) => {
      await identity(tx, who);
      const access = interviewId ? await interviewAccess(tx, who, interviewId) : undefined;
      const row = await load(tx, id, interviewId ? undefined : who.userId);
      if (interviewId && row.interview !== interviewId) throw missing();
      assertScope(who, row);
      const header = (
        await tx.execute<{ data: Uint8Array; version: string }>(
          sql`SELECT header_data AS data,xmin::text AS version FROM submission_result_headers WHERE submission_id=${id}::uuid`,
        )
      ).rows[0];
      if (!header && row.result) throw new Error("Submission result requires backfill");
      if (header && !["completed", "failed", "cancelled"].includes(row.state))
        throw new Error("Result is not terminal");
      const value = snapshot({ ...row, result: header?.data ?? null }, !interviewId);
      const hidden = Array.isArray(value.hiddenCases) ? value.hiddenCases : [];
      let hiddenCount = hidden.length;
      const headerFields: Record<string, string> = {};
      if (interviewId && access?.role !== "interviewer" && row.kind === "submit") {
        delete value.hiddenCases;
        delete value.diagnostics;
      }
      let count = 0,
        channel = "public",
        present = false,
        publicVersions: string[] = [],
        privateVersions: string[] = [];
      if (header) {
        const raw = object(
          parseLosslessJson(new TextDecoder("utf-8", { fatal: true }).decode(header.data)),
        );
        if (
          typeof raw.publicCasesPresent !== "boolean" ||
          !(raw.publicCaseCount instanceof JsonNumber) ||
          !/^(0|[1-9][0-9]*)$/.test(raw.publicCaseCount.lexeme) ||
          (raw.channel !== "public" && raw.channel !== "sample")
        )
          throw new Error("Invalid result header");
        const fieldRows = (
          await tx.execute<{ field: string; version: string }>(
            sql`SELECT field,xmin::text AS version FROM submission_result_header_fields WHERE submission_id=${id}::uuid`,
          )
        ).rows;
        for (const field of ["verdict", "infrastructureError", "hiddenCases", "diagnostics"]) {
          const flag = raw[field + "Present"];
          if (flag !== undefined && typeof flag !== "boolean")
            throw new Error("Invalid header field flag");
          const stored = fieldRows.find((row) => row.field === field);
          if ((flag === true) !== !!stored || (flag === true && raw[field] !== undefined))
            throw new Error("Incomplete result header field");
          if (stored) headerFields[field] = stored.version;
        }
        if (fieldRows.length !== Object.keys(headerFields).length)
          throw new Error("Unexpected result header field");
        if (headerFields.hiddenCases) {
          if (
            !(raw.hiddenCaseCount instanceof JsonNumber) ||
            !/^(0|[1-9][0-9]*)$/.test(raw.hiddenCaseCount.lexeme)
          )
            throw new Error("Invalid hidden case count");
          hiddenCount = Number(raw.hiddenCaseCount.lexeme);
          if (!Number.isSafeInteger(hiddenCount) || hiddenCount > 320)
            throw new Error("Invalid hidden case count");
        }
        count = Number(raw.publicCaseCount.lexeme);
        present = raw.publicCasesPresent;
        channel = raw.channel;
        if (
          !Number.isSafeInteger(count) ||
          count > 320 ||
          (!present && count) ||
          channel !== (row.kind === "run" ? "public" : "sample")
        )
          throw new Error("Invalid result count");
        const ready = (
          await tx.execute<{
            n: number;
            first: number | null;
            last: number | null;
            versions: string[];
          }>(
            sql`SELECT count(*)::int AS n,min(ordinal) AS first,max(ordinal) AS last,array_agg(xmin::text ORDER BY ordinal) AS versions FROM submission_public_result_cases WHERE submission_id=${id}::uuid AND channel=${channel}`,
          )
        ).rows[0];
        if (ready.n !== count || (count > 0 && (ready.first !== 0 || ready.last !== count - 1)))
          throw new Error("Submission result requires backfill");
        publicVersions = ready.versions ?? [];
      }
      let privatePlan: { ordinal: number; id: string; version: string; example?: boolean }[] = [];
      let fixture: Uint8Array | undefined,
        privateCount = 0;
      if (interviewId && access && row.kind === "submit") {
        const execution = (
          await tx.execute<{
            epoch: string;
            fixture: Uint8Array;
            stages: number;
            level: number;
            ids: string[];
            examples: number;
            resultCount: number;
          }>(
            sql`SELECT e.question_epoch::text AS epoch,e.fixture_id AS fixture,e.level,q.total_stages AS stages,q.private_ids AS ids,q.example_count AS examples,e.result_count AS "resultCount" FROM interview_execution_public e JOIN interview_snapshot_public q ON q.session_id=e.session_id AND q.fixture_id=e.fixture_id WHERE e.submission_id=${id}::uuid AND e.session_id=${interviewId}::uuid`,
          )
        ).rows[0];
        if (!execution) throw missing();
        fixture = execution.fixture;
        privateCount = execution.resultCount;
        if (access.role === "interviewer" || execution.epoch === access.epoch) {
          const metadata = (
            await tx.execute<{ ids: string[]; ordinals: number[]; versions: string[] }>(
              sql`SELECT ARRAY(SELECT case_id FROM interview_question_private_cases WHERE session_id=${interviewId}::uuid AND question_epoch=${execution.epoch}::uuid ORDER BY ordinal) AS ids,ARRAY(SELECT ordinal FROM interview_private_result_cases WHERE submission_id=${id}::uuid ORDER BY ordinal) AS ordinals,ARRAY(SELECT xmin::text FROM interview_private_result_cases WHERE submission_id=${id}::uuid ORDER BY ordinal) AS versions`,
            )
          ).rows[0];
          if (
            metadata.ids.length !== execution.ids.length ||
            metadata.ids.some((v, i) => v !== execution.ids[i]) ||
            metadata.ordinals.length !== execution.resultCount ||
            metadata.ordinals.some((v, i) => v !== i)
          )
            throw new Error("Interview private results require backfill");
          privateVersions = metadata.versions;
          const eligible = execution.stages
            ? execution.ids.filter((v) => {
                const m = /^level:(\d+):case:\d+$/.exec(v);
                return !!m && Number(m[1]) <= execution.level;
              })
            : execution.ids;
          const fallback = !execution.stages && !eligible.length;
          const candidates = fallback ? execution.examples : eligible.length;
          if (execution.resultCount || (row.state === "completed" && hiddenCount === candidates)) {
            if (fallback) {
              const levels = (
                await tx.execute<{ levels: number[]; version: string }>(
                  sql`SELECT ARRAY(SELECT level FROM interview_snapshot_public_examples WHERE session_id=${interviewId}::uuid AND fixture_id=${execution.fixture} ORDER BY level) AS levels,(SELECT xmin::text FROM interview_snapshot_public_examples WHERE session_id=${interviewId}::uuid AND fixture_id=${execution.fixture} AND level=0) AS version`,
                )
              ).rows[0];
              if (
                levels.levels.length !== execution.stages + 1 ||
                levels.levels.some((v, i) => v !== i)
              )
                throw new Error("Interview public results require backfill");
              privatePlan = Array.from({ length: candidates }, (_, ordinal) => ({
                ordinal,
                id: `example:${ordinal}`,
                example: true,
                version: levels.version,
              }));
            } else {
              const selected = await tx.execute<{ ordinal: number; id: string; version: string }>(
                sql`SELECT c.ordinal,c.case_id AS id,c.xmin::text AS version FROM interview_question_private_cases c JOIN interview_members m ON m.session_id=c.session_id AND m.user_id=${who.userId} AND m.removed_at IS NULL LEFT JOIN interview_case_visibility v ON v.session_id=c.session_id AND v.question_epoch=c.question_epoch AND v.case_id=c.case_id WHERE c.session_id=${interviewId}::uuid AND c.question_epoch=${execution.epoch}::uuid AND c.ordinal<${candidates} AND (m.role='interviewer' OR v.case_id IS NOT NULL) ORDER BY c.ordinal`,
              );
              privatePlan = selected.rows;
            }
          }
        }
      }
      return {
        row,
        value,
        access,
        count,
        channel,
        present,
        privatePlan,
        fixture,
        privateCount,
        hidden,
        hiddenCount,
        publicVersions,
        privateVersions,
        headerVersion: header?.version,
        headerFields,
      };
    }),
  );
  async function* bytes(
    kind: "public" | "case" | "private" | "example" | "header",
    ordinal: number,
    caseId = "",
  ): AsyncGenerator<string> {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    for (let offset = 1; ; offset += 65536) {
      const part = await run((scope) =>
        scope.transaction(options, async (tx) => {
          await identity(tx, who);
          const current = await load(tx, id, interviewId ? undefined : who.userId);
          assertScope(who, current);
          if (prepared.headerVersion) {
            const same = await tx.execute(
              sql`SELECT 1 FROM submission_result_headers WHERE submission_id=${id}::uuid AND xmin::text=${prepared.headerVersion}`,
            );
            if (!same.rows.length || !current.result)
              throw new Error("Result changed during streaming");
          }
          if (interviewId) {
            const access = await interviewAccess(tx, who, interviewId);
            if (
              current.interview !== interviewId ||
              access.role !== prepared.access?.role ||
              (access.role !== "interviewer" && access.epoch !== prepared.access?.epoch)
            )
              throw missing();
          }
          const query =
            kind === "header"
              ? sql`SELECT substring(field_data FROM ${offset} FOR 65536) AS data FROM submission_result_header_fields WHERE submission_id=${id}::uuid AND field=${caseId} AND xmin::text=${prepared.headerFields[caseId]}`
              : kind === "public"
                ? sql`SELECT substring(result_data FROM ${offset} FOR 65536) AS data FROM submission_public_result_cases WHERE submission_id=${id}::uuid AND channel=${prepared.channel} AND ordinal=${ordinal} AND xmin::text=${prepared.publicVersions[ordinal]}`
                : kind === "example"
                  ? sql`SELECT substring(x.examples FROM ${offset} FOR 65536) AS data FROM interview_snapshot_public_examples x JOIN interview_members m ON m.session_id=x.session_id AND m.user_id=${who.userId} AND m.removed_at IS NULL WHERE x.session_id=${interviewId}::uuid AND x.fixture_id=${prepared.fixture} AND x.level=0 AND x.xmin::text=${prepared.privatePlan[ordinal]?.version}`
                  : kind === "private"
                    ? sql`SELECT substring(r.result_data FROM ${offset} FOR 65536) AS data FROM interview_private_result_cases r JOIN interview_execution_public e ON e.submission_id=r.submission_id JOIN interviews i ON i.id=e.session_id JOIN interview_members m ON m.session_id=i.id AND m.user_id=${who.userId} AND m.removed_at IS NULL LEFT JOIN interview_question_private_cases c ON c.session_id=e.session_id AND c.question_epoch=e.question_epoch AND c.ordinal=r.ordinal LEFT JOIN interview_case_visibility v ON v.session_id=c.session_id AND v.question_epoch=c.question_epoch AND v.case_id=c.case_id WHERE r.submission_id=${id}::uuid AND e.session_id=${interviewId}::uuid AND r.ordinal=${ordinal} AND r.xmin::text=${prepared.privateVersions[ordinal]} AND (m.role='interviewer' OR (i.question_epoch=e.question_epoch AND (${caseId.startsWith("example:")} OR v.case_id IS NOT NULL)))`
                    : sql`SELECT substring(c.case_data FROM ${offset} FOR 65536) AS data FROM interview_question_private_cases c JOIN interview_execution_public e ON e.session_id=c.session_id AND e.question_epoch=c.question_epoch JOIN interviews i ON i.id=e.session_id JOIN interview_members m ON m.session_id=i.id AND m.user_id=${who.userId} AND m.removed_at IS NULL LEFT JOIN interview_case_visibility v ON v.session_id=c.session_id AND v.question_epoch=c.question_epoch AND v.case_id=c.case_id WHERE e.submission_id=${id}::uuid AND e.session_id=${interviewId}::uuid AND c.ordinal=${ordinal} AND c.case_id=${caseId} AND c.xmin::text=${prepared.privatePlan.find((v) => v.ordinal === ordinal)?.version} AND (m.role='interviewer' OR (i.question_epoch=e.question_epoch AND v.case_id IS NOT NULL))`;
          const row = (await tx.execute<{ data: Uint8Array }>(query)).rows[0];
          if (!row) throw new Error("Result changed during streaming");
          return row.data;
        }),
      );
      const text = decoder.decode(part, { stream: true });
      if (text) yield text;
      if (part.byteLength < 65536) break;
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  }
  async function* chunks(): AsyncGenerator<string> {
    const prefix = encode(prepared.value);
    yield prefix.slice(0, -1);
    for (const field of ["verdict", "infrastructureError", "hiddenCases", "diagnostics"]) {
      if (
        !prepared.headerFields[field] ||
        (prepared.row.interview &&
          (!interviewId || prepared.access?.role !== "interviewer") &&
          prepared.row.kind === "submit" &&
          (field === "hiddenCases" || field === "diagnostics"))
      )
        continue;
      yield "," + JSON.stringify(field) + ":";
      yield* bytes("header", 0, field);
    }
    if (prepared.present) {
      yield ',"publicCases":[';
      for (let ordinal = 0; ordinal < prepared.count; ordinal++) {
        if (ordinal) yield ",";
        yield* bytes("public", ordinal);
      }
      yield "]";
    }
    if (interviewId && prepared.privatePlan.length) {
      yield ',"privateCaseResults":[';
      for (const [index, entry] of prepared.privatePlan.entries()) {
        yield (index ? "," : "") + '{"caseId":' + JSON.stringify(entry.id) + ',"case":';
        const input = new StreamingJsonReader(
          bytes(entry.example ? "example" : "case", entry.ordinal, entry.id)[
            Symbol.asyncIterator
          ](),
        );
        if (entry.example) {
          await input.expect("[");
          for (let n = 0; n < entry.ordinal; n++) {
            for await (const _ of input.valueChunks()) {
            }
            await input.expect(",");
          }
        }
        yield* projectedObject(input, new Set(["args", "expected", "calls"]), true);
        if (entry.ordinal < prepared.privateCount) {
          yield ",";
          let first = true;
          for await (const part of bytes("private", entry.ordinal, entry.id)) {
            if (first) {
              if (!part.startsWith("{")) throw new Error("Invalid private result");
              yield part.slice(1);
              first = false;
            } else yield part;
          }
          if (first) throw new Error("Invalid private result");
        } else {
          if (prepared.headerFields.hiddenCases && entry.ordinal < prepared.hiddenCount) {
            const input = new StreamingJsonReader(
              bytes("header", 0, "hiddenCases")[Symbol.asyncIterator](),
            );
            await input.expect("[");
            for (let n = 0; n < entry.ordinal; n++) {
              for await (const _ of input.valueChunks()) {
              }
              await input.expect(",");
            }
            yield ",";
            let first = true;
            for await (const part of input.valueChunks()) {
              if (first) {
                if (!part.startsWith("{")) throw new Error("Invalid hidden status");
                yield part.slice(1);
                first = false;
              } else yield part;
            }
          } else {
            const detail = prepared.hidden[entry.ordinal]
              ? resultCase(prepared.hidden[entry.ordinal], false)
              : { index: new JsonNumber(String(entry.ordinal)) };
            yield "," + stringifyLosslessJson(detail).slice(1);
          }
        }
      }
      yield "]";
    }
    yield "}";
  }
  return jsonStream(chunks());
}
