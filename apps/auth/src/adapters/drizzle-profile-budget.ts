import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { auth } from "@quorem/database/schema";
import type { ConnectionScope } from "@quorem/database/core";
import { profileMutationLifetimeMs, type ProfileMutationBudget } from "../profile-budget.ts";

type RunScope = <T>(callback: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const {
  profile_mutation_windowInQuorem_auth: windows,
  profile_mutation_leaseInQuorem_auth: leases,
} = auth;
const options = { statementTimeoutMs: 5000, lockTimeoutMs: 5000 };

export function drizzleProfileBudget(run: RunScope): ProfileMutationBudget {
  return {
    acquire(userId) {
      const ownerHash = createHash("sha256").update(userId).digest("hex");
      const id = crypto.randomUUID(),
        generation = crypto.randomUUID();
      return run((scope) =>
        scope.transaction(options, async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(714901,12)`);
          await tx.execute(sql`DELETE FROM ${windows} WHERE expires_at<=clock_timestamp()`);
          const counts = await tx.execute(
            sql`SELECT (SELECT count(*)::int FROM ${windows}) AS subjects, (SELECT count(*)::int FROM ${leases}) AS active`,
          );
          const existing = await tx.execute(
            sql`SELECT used, GREATEST(1,CEIL(EXTRACT(EPOCH FROM expires_at-clock_timestamp())))::integer AS retry FROM ${windows} WHERE owner_hash=${ownerHash}`,
          );
          const window = existing.rows[0];
          if (
            Number(counts.rows[0].active) >= 4 ||
            (!window && Number(counts.rows[0].subjects) >= 10000) ||
            (window && Number(window.used) >= 10)
          )
            return {
              allowed: false,
              retryAfterSeconds: window && Number(window.used) >= 10 ? Number(window.retry) : 1,
            };
          await tx.execute(
            sql`INSERT INTO ${windows} AS w(owner_hash,used,expires_at) VALUES(${ownerHash},1,clock_timestamp()+interval '60 seconds') ON CONFLICT(owner_hash) DO UPDATE SET used=w.used+1`,
          );
          const saved = await tx.execute(
            sql`INSERT INTO ${leases}(id,owner_hash,generation,deadline_at) VALUES(${id},${ownerHash},${generation},clock_timestamp()+${profileMutationLifetimeMs}*interval '1 millisecond') RETURNING floor(extract(epoch from deadline_at)*1000)::bigint AS deadline`,
          );
          return {
            allowed: true,
            lease: { id, ownerHash, generation, deadlineUnixMs: Number(saved.rows[0].deadline) },
          };
        }),
      );
    },
    release(lease) {
      return run((scope) =>
        scope.transaction(options, async (tx) => {
          await tx.execute(
            sql`DELETE FROM ${leases} WHERE id=${lease.id} AND owner_hash=${lease.ownerHash} AND generation=${lease.generation}`,
          );
        }),
      );
    },
  };
}
