/** @file refresh-question-languages.ts @description Refresh derived catalog languages through authorized authoring. @module cli */
import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { readAuthoringQuestion } from "../adapters/postgres/problems/private-content.ts";
import { languageRuntime } from "@quorem/execution";
import { questionAuthoring } from "../adapters/postgres/problems/authoring/repository.ts";
import { verifiedOperator } from "./operator-backfill.ts";

/** Preview by default; applying preserves question identities and uses normal judging fences. */
export async function refreshQuestionLanguages(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      apply: { type: "boolean", default: false },
      "op-id": { type: "string" },
      reason: { type: "string" },
      limit: { type: "string", default: "16" },
      after: { type: "string" },
      id: { type: "string" },
    },
  });
  const limit = Number(values.limit);
  if (!/^[1-9]\d*$/.test(values.limit!) || limit > 64) throw new Error("Limit must be 1-64");
  if (values.apply && (!values["op-id"] || !values.reason))
    throw new Error("Operation ID and reason required to apply");
  const url = process.env.QUOREM_OPERATOR_DATABASE_URL;
  const issuer = process.env.AUTH_ORIGIN;
  if (!url || !issuer) throw new Error("Operator database and issuer required");
  const pool = createNodePool({
    connectionString: url,
    max: 2,
    connectionTimeoutMs: 5000,
    idleTimeoutMs: 5000,
    onIdleError: () => {},
  });
  const run = <T>(fn: Parameters<typeof withNodeConnection<T>>[2]) =>
    withNodeConnection(pool, { lifetimeMs: 30000 }, fn);
  try {
    const targets = await run((scope) =>
      scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
        await verifiedOperator(tx, issuer);
        return (
          await tx.execute<{ id: string; slug: string }>(sql`
          SELECT v.id::text,p.slug FROM problems p JOIN problem_versions v ON v.id=p.current_version_id
          WHERE p.owner_id IS NULL AND (${values.id ?? null}::uuid IS NULL OR v.id=${values.id ?? null}::uuid) AND (${values.after ?? null}::uuid IS NULL OR v.id>${values.after ?? null}::uuid)
          ORDER BY v.id LIMIT ${limit}
        `)
        ).rows;
      }),
    );
    if (!values.apply) return { applied: false, targets, after: targets.at(-1)?.id };
    for (const target of targets) {
      // One transaction includes audit, draft synchronization and publication replacement.
      await run((scope) =>
        scope.transaction({ statementTimeoutMs: 15000, lockTimeoutMs: 1000 }, async (tx) => {
          const userId = await verifiedOperator(tx, issuer);
          const operation = `${values["op-id"]}:${target.id}`;
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${operation},740099))`,
          );
          const prior = (
            await tx.execute<{ actor: string; action: string; scope: string; reason: string }>(sql`
            SELECT actor,action,scope,reason FROM access_audit WHERE operation_id=${operation}
          `)
          ).rows[0];
          if (prior) {
            if (
              prior.actor !== userId ||
              prior.action !== "questions.languages.refresh" ||
              prior.scope !== target.id ||
              prior.reason !== values.reason
            )
              throw new Error("Operation ID already used");
            return;
          }
          const authoring = questionAuthoring(
            async (action) =>
              action({ ...scope, transaction: async (_options, callback) => callback(tx) }),
            languageRuntime,
          );
          const actor = { userId, admin: true, globalAllowed: true };
          const draft = JSON.parse(await authoring.create(actor, undefined, target.id, true)) as {
            id: string;
            revision: string;
          };
          const source = await readAuthoringQuestion(tx, userId, target.id, true, true);
          if (!source) throw new Error("Current publication changed");
          await authoring.update(actor, draft.id, draft.revision, source);
          await tx.execute(sql`
            INSERT INTO access_audit(operation_id,actor,user_id,action,scope,reason)
            VALUES(${operation},${userId},${userId},'questions.languages.refresh',${target.id},${values.reason!})
          `);
        }),
      );
    }
    return { applied: true, targets, after: targets.at(-1)?.id };
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(await refreshQuestionLanguages(process.argv.slice(2))));
  } catch {
    console.error("Question language refresh failed");
    process.exitCode = 1;
  }
}
