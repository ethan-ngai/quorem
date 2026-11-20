/** @file socket-leases.ts @description Lobby presence changes at socket lifecycle edges. @module parties */
import { sql } from "drizzle-orm";
import type { ConnectionScope, Transaction } from "@quorem/database/core";
import type { Principal } from "../../../modules/identity/model.ts";
import { acquireSocketLease, renewSocketLease } from "../events/socket/leases.ts";
import { lockMatchOwner } from "../matches/lifecycle/repository.ts";
import { lockParty, missing, online, validateGuest } from "./store.ts";

type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const options = { statementTimeoutMs: 3000, lockTimeoutMs: 1000 };

async function authorize(tx: Transaction, who: Principal, id: string) {
  if (who.kind === "guest" && (who.scope.kind !== "party" || who.scope.partyId !== id))
    throw missing();
  await lockMatchOwner(tx, who);
  await validateGuest(tx, who);
  await lockParty(tx, id, who.userId);
}

export function partySocketLeases(run: Run) {
  const transaction = <T>(fn: (tx: Transaction) => Promise<T>) =>
    run((scope) => scope.transaction(options, fn));
  return {
    acquire: (who: Principal, id: string, expiresAt?: number) =>
      transaction(async (tx) => {
        const check = () => authorize(tx, who, id);
        await check();
        const prior = await tx.execute<{ online: boolean }>(sql`
          SELECT (${online}) AS online FROM party_members pm
          WHERE pm.party_id=${id}::uuid AND pm.owner_id=${who.userId}
        `);
        const lease = await acquireSocketLease(
          tx,
          `/parties/${id}`,
          who.userId,
          check,
          sql`true`,
          expiresAt,
        );
        await tx.execute(sql`
          UPDATE party_members SET last_seen_at=clock_timestamp()
          WHERE party_id=${id}::uuid AND owner_id=${who.userId}
        `);
        if (!prior.rows[0]?.online)
          await tx.execute(sql`UPDATE parties SET version=version+1 WHERE id=${id}::uuid`);
        return lease;
      }),
    renew: (who: Principal, id: string, lease: string) =>
      transaction((tx) =>
        renewSocketLease(tx, `/parties/${id}`, who.userId, lease, () => authorize(tx, who, id)),
      ),
    release: (owner: string, id: string, lease: string) =>
      transaction(async (tx) => {
        await tx.execute(sql`SELECT 1 FROM parties WHERE id=${id}::uuid FOR UPDATE`);
        await tx.execute(sql`
          WITH closing AS (
            UPDATE realtime_presence_leases
            SET expires_at=LEAST(expires_at, clock_timestamp()+interval '20 seconds')
            WHERE id=${lease}::uuid AND subject=${owner} AND topic=${`/parties/${id}`}
            RETURNING id
          )
          UPDATE party_members SET last_seen_at=GREATEST(last_seen_at, clock_timestamp())
          WHERE party_id=${id}::uuid AND owner_id=${owner} AND EXISTS (SELECT FROM closing)
        `);
      }),
  };
}
