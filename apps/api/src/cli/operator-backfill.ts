/** @file operator-backfill.ts @description Audited bounded operator backfills. @module cli */
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  createNodePool,
  withNodeConnection,
  type ConnectionScope,
  type Transaction,
} from "@quorem/database/core";
import { backfillInterviewPrivateResultsBatch } from "../adapters/postgres/interviews/question/backfill.ts";
export class ResultBackfillFailure extends Error {
  readonly progress: {
    attempted: number;
    completed: number;
    normalized: number;
    statuses: number;
    privateStatuses: number;
    complete: false;
    outcomeUnknown: true;
  };
  constructor(progress: {
    attempted: number;
    completed: number;
    normalized: number;
    statuses: number;
    privateStatuses: number;
    complete: false;
    outcomeUnknown: true;
  }) {
    super("Result backfill interrupted");
    this.progress = progress;
  }
}

class DryRollback<T> {
  readonly value: T;
  constructor(value: T) {
    this.value = value;
  }
}

export async function verifiedOperator(tx: Transaction, issuer: string): Promise<string> {
  const row = (
    await tx.execute<{ user_id: string }>(
      sql`SELECT b.user_id FROM access_audit seed JOIN identity_bindings b ON b.user_id=seed.user_id AND b.subject=seed.scope JOIN quorem_auth."user" a ON a.id=b.subject JOIN users u ON u.id=b.user_id WHERE seed.operation_id='bootstrap:operator' AND b.issuer=${issuer} AND a."emailVerified" AND u.role='admin' AND NOT u.disabled FOR SHARE OF seed,u,b,a`,
    )
  ).rows[0];
  if (!row) throw new Error("Verified operator binding required");
  return row.user_id;
}

export async function runBackfill(args: string[]): Promise<{
  attempted: number;
  completed: number;
  complete: boolean;
  dryRun: boolean;
  normalized?: number;
  statuses?: number;
  privateStatuses?: number;
}> {
  const { values } = parseArgs({
    args,
    options: {
      "op-id": { type: "string" },
      reason: { type: "string" },
      limit: { type: "string", default: "16" },
      "max-batches": { type: "string", default: "100" },
      "dry-run": { type: "boolean", default: false },
      "private-results": { type: "boolean", default: false },
      results: { type: "boolean", default: false },
      "legacy-drained": { type: "boolean", default: false },
    },
  });
  if (values.results && values["private-results"]) throw new Error("Choose one backfill");
  if (!/^[1-9]\d*$/.test(values.limit!) || !/^[1-9]\d*$/.test(values["max-batches"]!))
    throw new Error("Invalid batch bounds");
  if (!values["dry-run"] && !values["legacy-drained"])
    throw new Error("Drain legacy writers and judges before backfill");
  const limit = Number(values.limit),
    maxBatches = Number(values["max-batches"]);
  if (
    !Number.isSafeInteger(limit) ||
    limit > 64 ||
    !Number.isSafeInteger(maxBatches) ||
    maxBatches > 1000 ||
    !values["op-id"] ||
    !values.reason
  )
    throw new Error("Operation ID, reason and bounded batches required");
  const url = process.env.QUOREM_OPERATOR_DATABASE_URL,
    issuer = process.env.AUTH_ORIGIN;
  if (!url || !issuer) throw new Error("Operator database and issuer required");
  const pool = createNodePool({
    connectionString: url,
    max: 2,
    connectionTimeoutMs: 5000,
    idleTimeoutMs: 5000,
    onIdleError: () => {},
  });
  const run = <T>(fn: (scope: Pick<ConnectionScope, "transaction">) => Promise<T>) =>
    withNodeConnection(pool, { lifetimeMs: 300000 }, fn);
  try {
    const action = values.results
      ? "judging.results.backfill"
      : values["private-results"]
        ? "interviews.private-results.backfill"
        : "interviews.runner-inputs.backfill";
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          limit,
          maxBatches,
          reason: values.reason,
          privateResults: values["private-results"],
          legacyDrained: values["legacy-drained"],
          ...(values.results ? { results: true } : {}),
        }),
      )
      .digest("hex");
    const actorId = await run((scope) =>
      scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
        const actor = await verifiedOperator(tx, issuer);
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${values["op-id"]!},740099))`,
        );
        const prior = (
          await tx.execute<{ actor: string; action: string; scope: string }>(
            sql`SELECT actor,action,scope FROM access_audit WHERE operation_id=${values["op-id"]!}`,
          )
        ).rows[0];
        if (
          prior &&
          (prior.actor !== actor || prior.action !== action || prior.scope !== fingerprint)
        )
          throw new Error("Operation ID already used");
        if (!values["dry-run"] && !prior)
          await tx.execute(
            sql`INSERT INTO access_audit(operation_id,actor,user_id,action,scope,reason) VALUES(${values["op-id"]!},${actor},${actor},${action},${fingerprint},${values.reason!})`,
          );
        return actor;
      }),
    );
    const guarded: typeof run = async (fn) =>
      run((scope) =>
        fn({
          transaction: (opts, action) =>
            scope.transaction(opts, async (tx) => {
              if (!opts.readOnly && (await verifiedOperator(tx, issuer)) !== actorId)
                throw new Error("Operator changed");
              return action(tx);
            }),
        }),
      );
    const effective: typeof run = values["dry-run"]
      ? async (fn) =>
          guarded((scope) =>
            fn({
              transaction: async (opts, action) => {
                if (opts.readOnly) return scope.transaction(opts, action);
                try {
                  return await scope.transaction(opts, async (tx) => {
                    throw new DryRollback(await action(tx));
                  });
                } catch (error) {
                  if (error instanceof DryRollback) return error.value as never;
                  throw error;
                }
              },
            }),
          )
      : guarded;
    let attempted = 0,
      completed = 0,
      complete = false;
    if (values.results) {
      const { backfillSubmissionBatch } =
        await import("../adapters/postgres/judging/results/backfill.ts");
      const { backfillPublicStatusBatch, publicStatusBackfillPending } =
        await import("../adapters/postgres/judging/results/status-backfill.ts");
      const { backfillOnePrivateStatusRun, privateStatusPending } =
        await import("../adapters/postgres/interviews/question/private-status-backfill.ts");
      let normalized = 0,
        statuses = 0,
        privateStatuses = 0,
        phase: "results" | "statuses" | "private" = "results";
      try {
        for (let i = 0; i < (values["dry-run"] ? 1 : maxBatches) && !complete; i++) {
          for (let j = 0; j < (values["dry-run"] ? 1 : limit); j++) {
            if (phase === "results") {
              const batch = await backfillSubmissionBatch(effective, 1);
              attempted += batch.attempted;
              completed += batch.completed;
              normalized += batch.completed;
              if (batch.attempted && !batch.completed) break;
              if (batch.attempted) continue;
              phase = "statuses";
            }
            if (phase === "statuses") {
              const count = await backfillPublicStatusBatch(effective, 1);
              attempted += count;
              completed += count;
              statuses += count;
              if (count) continue;
              const pending = await effective((scope) =>
                scope.transaction(
                  { statementTimeoutMs: 5000, lockTimeoutMs: 1000, readOnly: true },
                  publicStatusBackfillPending,
                ),
              );
              if (pending) break;
              phase = "private";
            }
            const found = await backfillOnePrivateStatusRun(effective);
            if (found) {
              attempted++;
              completed++;
              privateStatuses++;
              continue;
            }
            const pending = await effective((scope) =>
              scope.transaction(
                { statementTimeoutMs: 5000, lockTimeoutMs: 1000, readOnly: true },
                privateStatusPending,
              ),
            );
            if (!pending) complete = true;
            break;
          }
        }
      } catch {
        throw new ResultBackfillFailure({
          attempted,
          completed,
          normalized,
          statuses,
          privateStatuses,
          complete: false,
          outcomeUnknown: true,
        });
      }
      return {
        attempted,
        completed,
        complete,
        dryRun: values["dry-run"]!,
        normalized,
        statuses,
        privateStatuses,
      };
    }
    for (let i = 0; i < (values["dry-run"] ? 1 : maxBatches); i++) {
      const batch = values["private-results"]
        ? await backfillInterviewPrivateResultsBatch(effective, limit)
        : await (
            await import("../adapters/postgres/interviews/runner-inputs/legacy-backfill.ts")
          ).backfillRunnerInputsBatch(effective, limit);
      attempted += batch.attempted;
      completed += batch.completed;
      if (batch.attempted === 0) {
        complete = true;
        break;
      }
      if (batch.completed === 0) break;
    }
    return { attempted, completed, complete, dryRun: values["dry-run"]! };
  } finally {
    await pool.end();
  }
}
