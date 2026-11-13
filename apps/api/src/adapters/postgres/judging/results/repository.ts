import { workspaceAccess } from "../../workspace/access.ts";
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
import { guestScopeId, type Principal } from "../../../../modules/identity/model.ts";
import type { SubmissionSnapshots } from "../../../../modules/judging/results/model.ts";
import { authorizeReview } from "../../matches/review/authorization.ts";
import { guestMayReadMatch, lookupGuestInTransaction } from "../../identity/guest.ts";
import { encode, object, publicResult } from "./projection.ts";
import { jsonStream } from "../../../../modules/judging/results/stream.ts";
import { resultCase } from "./projection.ts";
import { projectedObject } from "./projected-stream.ts";
import { StreamingJsonReader } from "@quorem/questions";
import { interviewAccess } from "./interview.ts";
import { ResultArray } from "./array-stream.ts";
type Run = <T>(fn: (scope: Pick<ConnectionScope, "transaction">) => Promise<T>) => Promise<T>;
type Row = {
  id: string;
  workspace: string | null;
  owner: string;
  kind: string;
  practiceTarget: string | null;
  state: string;
  source_hash: string;
  admitted: string;
  updated: string;
  custom: boolean;
  interview: string | null;
  match: string | null;
  reviewMatch: string | null;
  reviewSource: string | null;
  result: Uint8Array | null;
};
const options = { statementTimeoutMs: 5000, lockTimeoutMs: 1000 };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const missing = () => new ApplicationError("not_found", "Submission not found", 404);
async function identity(tx: Transaction, who: Principal): Promise<void> {
  const user = await tx.execute(
    sql`SELECT id FROM users WHERE id=${who.userId} AND NOT disabled FOR NO KEY UPDATE`,
  );
  if (!user.rows.length) throw missing();
  if (who.kind === "guest") {
    const actual = await lookupGuestInTransaction(
      tx,
      who.scope.kind === "interview" ? "interview" : "match",
      who.sessionId,
    );
    if (
      !actual ||
      actual.userId !== who.userId ||
      actual.scope.kind !== who.scope.kind ||
      guestScopeId(actual.scope) !== guestScopeId(who.scope)
    )
      throw missing();
  }
}
async function load(
  tx: Transaction,
  id: string,
  owner?: string,
  lock = false,
  shared = false,
): Promise<Row> {
  if (!uuid.test(id)) throw missing();
  const result = await tx.execute<Row>(
    sql`SELECT s.id::text,s.workspace_id::text AS workspace,s.owner_id AS owner,s.kind,s.practice_target AS "practiceTarget",s.state,s.source_hash,to_char(s.admitted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS admitted,to_char(s.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated,s.custom_run AS custom,s.interview_id::text AS interview,s.match_id::text AS match,w.review_match_id::text AS "reviewMatch",w.review_source_owner_id AS "reviewSource",CASE WHEN s.result IS NULL THEN NULL ELSE convert_to('{}','UTF8') END AS result FROM submissions s LEFT JOIN workspaces w ON w.id=s.workspace_id WHERE s.id=${id}::uuid ${owner === undefined ? sql`` : sql`AND ${shared ? sql`(s.owner_id=${owner} OR ${workspaceAccess(owner)})` : sql`s.owner_id=${owner}`}`} ${lock ? sql`FOR UPDATE OF s` : sql``}`,
  );
  const row = result.rows[0];
  if (!row) throw missing();
  return row;
}
async function assertScope(tx: Transaction, who: Principal, row: Row): Promise<void> {
  if (row.reviewMatch && row.reviewSource) {
    await authorizeReview(tx, who, row.reviewMatch, row.reviewSource);
    return;
  }
  if (who.kind !== "guest") return;
  if (who.scope.kind === "interview") {
    if (row.interview !== who.scope.interviewId) throw missing();
  } else if (!row.match || !(await guestMayReadMatch(tx, who, row.match))) throw missing();
}
function snapshot(row: Row, hideInterview: boolean): { [key: string]: JsonValue } {
  return {
    id: row.id,
    ...(row.workspace ? { workspaceId: row.workspace } : {}),
    kind: row.kind,
    ...(row.practiceTarget ? { practiceTarget: row.practiceTarget } : {}),
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
            await assertScope(tx, who, row);
            return stringifyLosslessJson(object(parseLosslessJson(replay.response)));
          }
          const row = await load(tx, id, who.userId, true);
          await assertScope(tx, who, row);
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
    scope.transaction(options, async (tx) => {
      await identity(tx, who);
      const access = interviewId ? await interviewAccess(tx, who, interviewId) : undefined;
      const row = await load(tx, id, interviewId ? undefined : who.userId, true, true);
      if (interviewId && row.interview !== interviewId) throw missing();
      await assertScope(tx, who, row);
      const header = (
        await tx.execute<{ data: Uint8Array; version: string }>(
          sql`SELECT header_data AS data,xmin::text AS version FROM submission_result_headers WHERE submission_id=${id}::uuid`,
        )
      ).rows[0];
      if (!header && row.result) throw new Error("Submission result requires backfill");
      if (header && !["completed", "failed", "cancelled"].includes(row.state))
        throw new Error("Result is not terminal");
      const value = snapshot({ ...row, result: header?.data ?? null }, !interviewId);
      if (row.owner !== who.userId) value.canCancel = false;
      if (row.workspace && !row.interview && row.state === "running") {
        // Partial feedback contains only statuses signed for the current runner attempt.
        const progress = (
          await tx.execute<{ index: number; status: string; hidden: boolean }>(sql`
            SELECT CASE WHEN ${row.kind} = 'run' OR v.ordinal<i.case_count THEN v.ordinal ELSE v.ordinal-i.case_count END AS index,
              CASE WHEN ${row.kind} = 'submit' AND v.ordinal<i.case_count AND v.status NOT IN ('accepted','time_limit')
                THEN 'wrong_answer' ELSE v.status END AS status,
              ${row.kind} = 'submit' AND v.ordinal<i.case_count AS hidden
            FROM execution_jobs j
            JOIN runner_job_inputs i ON i.job_id=j.id AND i.sealed
            JOIN execution_verified_cases v ON v.job_id=j.id AND v.attempt_id=j.attempt_id
              AND v.sandbox_scope=j.sandbox_scope
            WHERE j.submission_id=${id}::uuid AND NOT j.finished AND j.lease_until>clock_timestamp()
            ORDER BY v.ordinal`)
        ).rows;
        const hidden: JsonValue[] = [];
        const samples: JsonValue[] = [];
        for (const { index, status, hidden: isHidden } of progress)
          (isHidden ? hidden : samples).push({ index: new JsonNumber(String(index)), status });
        if (hidden.length) value.hiddenCases = hidden;
        if (samples.length) value.publicCases = samples;
      }
      const hidden = Array.isArray(value.hiddenCases) ? value.hiddenCases : [];
      let hiddenCount = hidden.length;
      const headerFields: Record<string, string> = {};
      if (interviewId && access?.role !== "interviewer" && row.kind === "submit") {
        delete value.hiddenCases;
        delete value.diagnostics;
      }
      let count = 0,
        channel = "public",
        present = false;
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
          if (!Number.isSafeInteger(hiddenCount) || hiddenCount > 2147483647)
            throw new Error("Invalid hidden case count");
        }
        count = Number(raw.publicCaseCount.lexeme);
        present = raw.publicCasesPresent;
        channel = raw.channel;
        if (
          !Number.isSafeInteger(count) ||
          count > 2147483647 ||
          (!present && count) ||
          channel !== (row.kind === "run" ? "public" : "sample")
        )
          throw new Error("Invalid result count");
        const ready = (
          await tx.execute<{
            n: number;
            first: number | null;
            last: number | null;
          }>(
            sql`SELECT count(*)::int AS n,min(ordinal) AS first,max(ordinal) AS last FROM submission_public_result_cases WHERE submission_id=${id}::uuid AND channel=${channel}`,
          )
        ).rows[0];
        if (ready.n !== count || (count > 0 && (ready.first !== 0 || ready.last !== count - 1)))
          throw new Error("Submission result requires backfill");
      }
      let privatePlan:
        | { epoch: string; candidates: number; fallback: boolean; exampleVersion?: string }
        | undefined;
      let fixture: Uint8Array | undefined,
        privateCount = 0;
      if (interviewId && access && row.kind === "submit") {
        const execution = (
          await tx.execute<{
            epoch: string;
            fixture: Uint8Array;
            stages: number;
            level: number;
            examples: number;
            resultCount: number;
            idsMatch: boolean;
            resultCountActual: number;
            resultFirst: number | null;
            resultLast: number | null;
            eligible: number;
          }>(sql`
          SELECT e.question_epoch::text AS epoch,e.fixture_id AS fixture,e.level,q.total_stages AS stages,q.example_count AS examples,e.result_count AS "resultCount",
            q.private_ids IS NOT DISTINCT FROM ARRAY(SELECT c.case_id FROM interview_question_private_cases c WHERE c.session_id=e.session_id AND c.question_epoch=e.question_epoch ORDER BY c.ordinal) AS "idsMatch",
            (SELECT count(*)::int FROM interview_private_result_cases r WHERE r.submission_id=e.submission_id) AS "resultCountActual",
            (SELECT min(r.ordinal) FROM interview_private_result_cases r WHERE r.submission_id=e.submission_id) AS "resultFirst",
            (SELECT max(r.ordinal) FROM interview_private_result_cases r WHERE r.submission_id=e.submission_id) AS "resultLast",
            (SELECT count(*)::int FROM interview_question_private_cases c WHERE c.session_id=e.session_id AND c.question_epoch=e.question_epoch AND (q.total_stages=0 OR CASE WHEN c.case_id ~ '^level:[0-9]+:case:[0-9]+$' THEN split_part(c.case_id,':',2)::numeric<=e.level ELSE false END)) AS eligible
          FROM interview_execution_public e JOIN interview_snapshot_public q ON q.session_id=e.session_id AND q.fixture_id=e.fixture_id WHERE e.submission_id=${id}::uuid AND e.session_id=${interviewId}::uuid`)
        ).rows[0];
        if (!execution) throw missing();
        fixture = execution.fixture;
        privateCount = execution.resultCount;
        if (access.role === "interviewer" || execution.epoch === access.epoch) {
          if (
            !execution.idsMatch ||
            execution.resultCountActual !== execution.resultCount ||
            (execution.resultCount > 0 &&
              (execution.resultFirst !== 0 || execution.resultLast !== execution.resultCount - 1))
          )
            throw new Error("Interview private results require backfill");
          const fallback = !execution.stages && !execution.eligible;
          const candidates = fallback ? execution.examples : execution.eligible;
          if (execution.resultCount || (row.state === "completed" && hiddenCount === candidates)) {
            let exampleVersion: string | undefined;
            if (fallback) {
              const levels = (
                await tx.execute<{
                  n: number;
                  first: number | null;
                  last: number | null;
                  version: string;
                }>(
                  sql`SELECT count(*)::int AS n,min(level) AS first,max(level) AS last,max(xmin::text) FILTER (WHERE level=0) AS version FROM interview_snapshot_public_examples WHERE session_id=${interviewId}::uuid AND fixture_id=${execution.fixture}`,
                )
              ).rows[0];
              if (
                levels.n !== execution.stages + 1 ||
                levels.first !== 0 ||
                levels.last !== execution.stages ||
                !levels.version
              )
                throw new Error("Interview public results require backfill");
              exampleVersion = levels.version;
            }
            privatePlan = { epoch: execution.epoch, candidates, fallback, exampleVersion };
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
        headerVersion: header?.version,
        headerFields,
      };
    }),
  );
  async function authorizePage(tx: Transaction): Promise<void> {
    await identity(tx, who);
    const current = await load(tx, id, interviewId ? undefined : who.userId, false, true);
    await assertScope(tx, who, current);
    if (prepared.headerVersion) {
      const same = await tx.execute(
        sql`SELECT 1 FROM submission_result_headers WHERE submission_id=${id}::uuid AND xmin::text=${prepared.headerVersion}`,
      );
      if (!same.rows.length || !current.result) throw new Error("Result changed during streaming");
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
  }
  async function* bytes(
    kind: "public" | "case" | "private" | "example" | "header",
    ordinal: number,
    caseId = "",
    caseVersion?: string,
  ): AsyncGenerator<string> {
    let rowVersion: string | undefined =
      kind === "header"
        ? prepared.headerFields[caseId]
        : kind === "example"
          ? prepared.privatePlan?.exampleVersion
          : kind === "case"
            ? caseVersion
            : undefined;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    for (let offset = 1; ; offset += 65536) {
      const part = await run((scope) =>
        scope.transaction(options, async (tx) => {
          await authorizePage(tx);
          const query =
            kind === "header"
              ? sql`SELECT substring(field_data FROM ${offset} FOR 65536) AS data,xmin::text AS version FROM submission_result_header_fields WHERE submission_id=${id}::uuid AND field=${caseId} AND xmin::text=${rowVersion}`
              : kind === "public"
                ? sql`SELECT substring(result_data FROM ${offset} FOR 65536) AS data,xmin::text AS version FROM submission_public_result_cases WHERE submission_id=${id}::uuid AND channel=${prepared.channel} AND ordinal=${ordinal} ${rowVersion === undefined ? sql`` : sql`AND xmin::text=${rowVersion}`}`
                : kind === "example"
                  ? sql`SELECT substring(x.examples FROM ${offset} FOR 65536) AS data,x.xmin::text AS version FROM interview_snapshot_public_examples x JOIN interview_members m ON m.session_id=x.session_id AND m.user_id=${who.userId} AND m.removed_at IS NULL WHERE x.session_id=${interviewId}::uuid AND x.fixture_id=${prepared.fixture} AND x.level=0 AND x.xmin::text=${rowVersion}`
                  : kind === "private"
                    ? sql`SELECT substring(r.result_data FROM ${offset} FOR 65536) AS data,r.xmin::text AS version FROM interview_private_result_cases r JOIN interview_execution_public e ON e.submission_id=r.submission_id JOIN interviews i ON i.id=e.session_id JOIN interview_members m ON m.session_id=i.id AND m.user_id=${who.userId} AND m.removed_at IS NULL LEFT JOIN interview_question_private_cases c ON c.session_id=e.session_id AND c.question_epoch=e.question_epoch AND c.ordinal=r.ordinal LEFT JOIN interview_case_visibility v ON v.session_id=c.session_id AND v.question_epoch=c.question_epoch AND v.case_id=c.case_id WHERE r.submission_id=${id}::uuid AND e.session_id=${interviewId}::uuid AND r.ordinal=${ordinal} ${rowVersion === undefined ? sql`` : sql`AND r.xmin::text=${rowVersion}`} AND (m.role='interviewer' OR (i.question_epoch=e.question_epoch AND (${caseId.startsWith("example:")} OR v.case_id IS NOT NULL)))`
                    : sql`SELECT substring(c.case_data FROM ${offset} FOR 65536) AS data,c.xmin::text AS version FROM interview_question_private_cases c JOIN interview_execution_public e ON e.session_id=c.session_id AND e.question_epoch=c.question_epoch JOIN interviews i ON i.id=e.session_id JOIN interview_members m ON m.session_id=i.id AND m.user_id=${who.userId} AND m.removed_at IS NULL LEFT JOIN interview_case_visibility v ON v.session_id=c.session_id AND v.question_epoch=c.question_epoch AND v.case_id=c.case_id WHERE e.submission_id=${id}::uuid AND e.session_id=${interviewId}::uuid AND c.ordinal=${ordinal} AND c.case_id=${caseId} AND c.xmin::text=${rowVersion} AND (m.role='interviewer' OR (i.question_epoch=e.question_epoch AND v.case_id IS NOT NULL))`;
          const row = (await tx.execute<{ data: Uint8Array; version: string }>(query)).rows[0];
          if (!row) throw new Error("Result changed during streaming");
          return row;
        }),
      );
      rowVersion ??= part.version;
      const text = decoder.decode(part.data, { stream: true });
      if (text) yield text;
      if (part.data.byteLength < 65536) break;
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
      for (let ordinal = 0; ordinal < prepared.count;) {
        if (interviewId) {
          if (ordinal) yield ",";
          yield* bytes("public", ordinal++);
          continue;
        }
        // Match the existing page byte budget without a connection per small case.
        const window = await run((scope) =>
          scope.transaction(options, async (tx) => {
            await authorizePage(tx);
            return (
              await tx.execute<{ ordinal: number; data: Uint8Array | null }>(sql`
            WITH candidates AS (
              SELECT ordinal,result_data FROM submission_public_result_cases
              WHERE submission_id=${id}::uuid AND channel=${prepared.channel}
                AND ordinal>=${ordinal} AND ordinal<${prepared.count}
              ORDER BY ordinal LIMIT 64
            ), sized AS (
              SELECT *,sum(octet_length(result_data)) OVER (ORDER BY ordinal) AS bytes FROM candidates
            ) SELECT ordinal,CASE WHEN bytes<=65536 THEN result_data END AS data FROM sized ORDER BY ordinal
          `)
            ).rows;
          }),
        );
        if (!window.length) throw new Error("Result changed during streaming");
        let consumed = 0;
        for (const part of window) {
          if (part.ordinal !== ordinal) throw new Error("Result changed during streaming");
          if (part.data === null) break;
          if (ordinal) yield ",";
          yield new TextDecoder("utf-8", { fatal: true }).decode(part.data);
          ordinal++;
          consumed++;
        }
        if (!consumed) {
          if (ordinal) yield ",";
          yield* bytes("public", ordinal++);
        }
      }
      yield "]";
    }
    if (interviewId && prepared.privatePlan) {
      const plan = prepared.privatePlan;
      async function* entries(): AsyncGenerator<{
        ordinal: number;
        id: string;
        version?: string;
        example?: boolean;
      }> {
        if (plan.fallback) {
          for (let ordinal = 0; ordinal < plan.candidates; ordinal++)
            yield { ordinal, id: `example:${ordinal}`, example: true };
          return;
        }
        let cursor = 0;
        while (cursor < plan.candidates) {
          const entry = await run((scope) =>
            scope.transaction(options, async (tx) => {
              await authorizePage(tx);
              return (
                await tx.execute<{ ordinal: number; id: string; version: string }>(
                  sql`SELECT c.ordinal,c.case_id AS id,c.xmin::text AS version FROM interview_question_private_cases c JOIN interview_members m ON m.session_id=c.session_id AND m.user_id=${who.userId} AND m.removed_at IS NULL LEFT JOIN interview_case_visibility v ON v.session_id=c.session_id AND v.question_epoch=c.question_epoch AND v.case_id=c.case_id WHERE c.session_id=${interviewId}::uuid AND c.question_epoch=${plan.epoch}::uuid AND c.ordinal>=${cursor} AND c.ordinal<${plan.candidates} AND (m.role='interviewer' OR v.case_id IS NOT NULL) ORDER BY c.ordinal LIMIT 1`,
                )
              ).rows[0];
            }),
          );
          if (!entry) break;
          cursor = entry.ordinal + 1;
          yield entry;
        }
      }
      const authorizeArray = (kind: "example" | "header") =>
        run((scope) =>
          scope.transaction(options, async (tx) => {
            await authorizePage(tx);
            const current = await tx.execute(
              kind === "example"
                ? sql`SELECT 1 FROM interview_snapshot_public_examples WHERE session_id=${interviewId}::uuid AND fixture_id=${prepared.fixture} AND level=0 AND xmin::text=${plan.exampleVersion}`
                : sql`SELECT 1 FROM submission_result_header_fields WHERE submission_id=${id}::uuid AND field='hiddenCases' AND xmin::text=${prepared.headerFields.hiddenCases}`,
            );
            if (!current.rows.length) throw new Error("Result changed during streaming");
          }),
        );
      const examples = plan.fallback
        ? new ResultArray(bytes("example", 0)[Symbol.asyncIterator](), () =>
            authorizeArray("example"),
          )
        : undefined;
      const hidden = prepared.headerFields.hiddenCases
        ? new ResultArray(bytes("header", 0, "hiddenCases")[Symbol.asyncIterator](), () =>
            authorizeArray("header"),
          )
        : undefined;
      let index = 0;
      try {
        for await (const entry of entries()) {
          const input = entry.example
            ? await examples!.at(entry.ordinal)
            : new StreamingJsonReader(
                bytes("case", entry.ordinal, entry.id, entry.version)[Symbol.asyncIterator](),
              );
          if (index === 0) yield ',"privateCaseResults":[';
          yield (index++ ? "," : "") + '{"caseId":' + JSON.stringify(entry.id) + ',"case":';
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
              const input = await hidden!.at(entry.ordinal);
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
      } finally {
        await Promise.all([examples?.close(), hidden?.close()]);
      }
      if (index) yield "]";
    }
    yield "}";
  }
  return jsonStream(chunks());
}
