/** @file leases.ts @description Match-authorized realtime window leases. @module matches */
import type { ConnectionScope, Transaction } from "@quorem/database/core";
import { sql } from "drizzle-orm";
import type { Principal } from "../../../../modules/identity/model.ts";
import { ApplicationError } from "../../../../application/error.ts";
import {
  acquireSocketLease,
  renewSocketLease,
  releaseSocketLease,
} from "../../events/socket/leases.ts";
import {
  lockMatch,
  lockMatchHost,
  lockMatchOwner,
  requireMatchMember,
} from "../lifecycle/repository.ts";
type Run = <T>(f: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const options = { statementTimeoutMs: 3000, lockTimeoutMs: 1000 };
const topic = (id: string, team?: number) =>
  team === undefined ? `/matches/${id}` : `/teams/${id}:${team}`;
async function authorize(tx: Transaction, actor: Principal, id: string) {
  await lockMatchOwner(tx, actor);
  const host = await lockMatchHost(tx, id);
  const match = await lockMatch(tx, id);
  if (host !== match.host) throw new ApplicationError("forbidden", "Match unavailable", 403);
  await requireMatchMember(tx, actor, id);
}
export function matchSocketLeases(run: Run) {
  const tx = <T>(f: (tx: Transaction) => Promise<T>) =>
    run((scope) => scope.transaction(options, f));
  return {
    acquire: (actor: Principal, id: string, expiresAt?: number, team?: number) =>
      tx(async (t) => {
        await authorize(t, actor, id);
        return acquireSocketLease(
          t,
          topic(id, team),
          actor.userId,
          () => authorize(t, actor, id),
          sql`true`,
          expiresAt,
        );
      }),
    renew: (actor: Principal, id: string, lease: string) =>
      tx((t) =>
        renewSocketLease(t, `/matches/${id}`, actor.userId, lease, () => authorize(t, actor, id)),
      ),
    release: (owner: string, id: string, lease: string, team?: number) =>
      tx((t) => releaseSocketLease(t, topic(id, team), owner, lease)),
  };
}
