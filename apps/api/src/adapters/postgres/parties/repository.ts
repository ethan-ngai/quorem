/** @file repository.ts @description Transactional party commands and snapshots. @module parties */
import { sql } from "drizzle-orm";
import {
  classifyDatabaseError,
  type ConnectionScope,
  type Transaction,
} from "@quorem/database/core";
import {
  activateDeadline,
  type Receipts,
  type Coordinator,
} from "../../../modules/events/scheduling/scheduling.ts";
import { ApplicationError } from "../../../application/error.ts";
import { validGuestToken, guestTokenHash } from "../../../modules/identity/guest/credentials.ts";
import { consumePrearm } from "../events/scheduling/prearm.ts";
import { capabilitiesInTransaction } from "../access/repository.ts";
import { guestMayAccessParty } from "../identity/guest.ts";
import type { Principal } from "../../../modules/identity/model.ts";
import {
  normalizePartySettings,
  type Parties,
  type PartySettings,
} from "../../../modules/parties/model.ts";
import { lockMatchOwner, hosting } from "../matches/lifecycle/repository.ts";
import { digest, fingerprint, inviteCipher, token } from "../matches/lifecycle/crypto.ts";
import { validateSelectedMatchProblem } from "../matches/selection/repository.ts";
import { matchEvent, finishMatch, reconcileMatch } from "../matches/reconcile/repository.ts";

import { uuid, missing, conflict, validateGuest, lockParty, snapshot, reset } from "./store.ts";
import { startRound, transferHost, reconcileParty, scheduleIfReady } from "./reconcile.ts";
export { reconcileParty } from "./reconcile.ts";

type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const options = { statementTimeoutMs: 5000, lockTimeoutMs: 1000 };
export function partyRepository(
  run: Run,
  inviteKey: Uint8Array,
  coordinator: Coordinator,
  shards: number,
  receipts: Receipts,
  guestCreation = false,
): Parties {
  const transact = <T>(fn: (tx: Transaction) => Promise<T>) =>
    run((scope) => scope.transaction(options, fn));
  const cipher = inviteCipher(inviteKey);
  async function command(
    who: Principal,
    route: string,
    key: string,
    body: unknown,
    fn: (tx: Transaction) => Promise<unknown>,
    deadlineId?: string,
  ) {
    const hash = await fingerprint(body);
    const perform = (receipt?: { id: string; shard: number }) =>
      transact(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${who.userId + ":party:" + route + ":" + key},740040))`,
        );
        await lockMatchOwner(tx, who);
        await validateGuest(tx, who);
        const prior = (
          await tx.execute<{ hash: string; response: unknown }>(
            sql`SELECT body_hash AS hash,response FROM match_idempotency WHERE owner_id=${who.userId} AND route=${"party:" + route} AND key=${key} AND expires_at>clock_timestamp()`,
          )
        ).rows[0];
        if (prior) {
          if (prior.hash !== hash)
            throw new ApplicationError(
              "idempotency_conflict",
              "Key was used for a different command",
              409,
            );
          const replay = route === "create" ? await cipher.open(prior.response) : prior.response;
          if (route === "create") {
            const value = replay as { party?: { id?: string }; inviteUrl?: string };
            if (!value.party?.id || !value.inviteUrl?.startsWith("/invite/")) throw missing();
            await lockParty(tx, value.party.id, who.userId);
            if (
              !(
                await tx.execute(
                  sql`SELECT 1 FROM parties WHERE id=${value.party.id}::uuid AND host_owner_id=${who.userId} AND invite_hash=${await digest(value.inviteUrl.slice(8))}`,
                )
              ).rows.length
            )
              throw missing();
          } else if (route === "join") {
            const id = (replay as { id?: string }).id;
            if (!id) throw missing();
            await lockParty(tx, id, who.userId);
          } else if (!route.startsWith("leave:") && !route.startsWith("disband:")) {
            await lockParty(tx, route.slice(route.indexOf(":") + 1), who.userId);
          }
          if (receipt) await consumePrearm(tx, receipt.id, receipt.shard);
          return replay;
        }
        const value = await fn(tx),
          saved = route === "create" ? await cipher.seal(value) : value;
        await tx.execute(
          sql`INSERT INTO match_idempotency(owner_id,route,key,body_hash,response,expires_at) VALUES(${who.userId},${"party:" + route},${key},${hash},${JSON.stringify(saved)}::jsonb,clock_timestamp()+interval '24 hours') ON CONFLICT(owner_id,route,key) DO UPDATE SET body_hash=excluded.body_hash,response=excluded.response,expires_at=excluded.expires_at`,
        );
        if (receipt) await consumePrearm(tx, receipt.id, receipt.shard);
        return value;
      });
    if (!deadlineId) return perform();
    const shard = parseInt(deadlineId.slice(0, 8), 16) % shards;
    return activateDeadline(receipts, coordinator, shard, (id) => perform({ id, shard }));
  }
  const repo: Parties = {
    async current(who) {
      return transact(async (tx) => {
        await lockMatchOwner(tx, who);
        if (
          who.kind === "guest" &&
          (who.scope.kind !== "party" || !(await guestMayAccessParty(tx, who, who.scope.partyId)))
        )
          throw missing();
        const row = (
          await tx.execute<{ id: string }>(
            sql`SELECT party_id::text AS id FROM party_members WHERE owner_id=${who.userId}`,
          )
        ).rows[0];
        if (row) {
          await validateGuest(tx, who);
          await reconcileParty(tx, row.id);
        }
        return {
          party:
            row &&
            (
              await tx.execute(
                sql`SELECT 1 FROM party_members WHERE party_id=${row.id}::uuid AND owner_id=${who.userId}`,
              )
            ).rows.length
              ? await snapshot(tx, row.id)
              : null,
        };
      });
    },
    async read(who, id) {
      return transact(async (tx) => {
        await lockMatchOwner(tx, who);
        await validateGuest(tx, who);
        await lockParty(tx, id, who.userId);
        await reconcileParty(tx, id);
        await lockParty(tx, id, who.userId);
        return snapshot(tx, id);
      });
    },
    async create(who, key, input) {
      const s = normalizePartySettings(input),
        id = crypto.randomUUID();
      if (s.accessMode === "guests_allowed" && !guestCreation)
        throw new ApplicationError(
          "guest_hosting_paused",
          "Guest hosting is temporarily paused",
          409,
        );
      return command(
        who,
        "create",
        key,
        s,
        async (tx) => {
          await hosting(tx, who.userId, s.accessMode);
          await validateSelectedMatchProblem(tx, who.userId, s);
          if (
            (await tx.execute(sql`SELECT 1 FROM party_members WHERE owner_id=${who.userId}`)).rows
              .length
          )
            throw conflict("Leave your current party first");
          const secret = token();
          await tx.execute(
            sql`INSERT INTO parties(id,host_owner_id,invite_hash,settings) VALUES(${id}::uuid,${who.userId},${await digest(secret)},${JSON.stringify(s)}::jsonb)`,
          );
          await tx.execute(
            sql`INSERT INTO party_members(party_id,owner_id,seat) VALUES(${id}::uuid,${who.userId},1)`,
          );
          return { party: await snapshot(tx, id), inviteUrl: `/invite/${secret}` };
        },
        id,
      );
    },
    async preview(raw) {
      if (!validGuestToken(raw)) throw missing();
      const hash = await digest(raw);
      return transact(async (tx) => {
        const row = (
          await tx.execute<{ data: unknown }>(
            sql`SELECT jsonb_build_object('id',p.id,'guestAllowed',(p.settings->>'accessMode'='guests_allowed' AND NOT (p.settings->>'admissionLocked')::boolean AND p.guest_joins<32),'participantCount',(SELECT count(*) FROM party_members WHERE party_id=p.id),'capacity',CASE WHEN p.settings->>'mode'='showdown' THEN 2 ELSE 8 END) AS data FROM parties p JOIN users h ON h.id=p.host_owner_id AND NOT h.disabled WHERE p.invite_hash=${hash} AND p.disbanded_at IS NULL`,
          )
        ).rows[0];
        if (!row) throw missing();
        return row.data;
      });
    },
    async join(who, key, raw) {
      if (who.kind === "guest")
        throw new ApplicationError("forbidden", "Use guest invitation", 403);
      if (!validGuestToken(raw)) throw missing();
      const hash = await digest(raw);
      return command(who, "join", key, raw, async (tx) => {
        const row = (
          await tx.execute<{ id: string; settings: PartySettings }>(
            sql`SELECT id::text,settings FROM parties WHERE invite_hash=${hash} AND disbanded_at IS NULL FOR UPDATE`,
          )
        ).rows[0];
        if (!row) throw missing();
        if (row.settings.admissionLocked) throw conflict("Party admission is locked");
        if (
          (await tx.execute(sql`SELECT 1 FROM party_members WHERE owner_id=${who.userId}`)).rows
            .length
        )
          throw conflict("Leave your current party first");
        const cap = row.settings.mode === "showdown" ? 2 : 8;
        const seat = (
          await tx.execute<{ n: number }>(
            sql`SELECT COALESCE(min(n),0)::int AS n FROM generate_series(1,${cap}) n WHERE NOT EXISTS(SELECT 1 FROM party_members WHERE party_id=${row.id}::uuid AND seat=n)`,
          )
        ).rows[0].n;
        if (!seat) throw conflict("Party is full");
        await tx.execute(
          sql`INSERT INTO party_members(party_id,owner_id,seat) VALUES(${row.id}::uuid,${who.userId},${seat})`,
        );
        await reset(tx, row.id);
        return snapshot(tx, row.id);
      });
    },
    async joinGuest(raw, credential, inputName) {
      if (!validGuestToken(raw) || !validGuestToken(credential)) throw missing();
      const name = inputName.trim();
      if (!name || Array.from(name).length > 40 || /[\r\n\t\0]/.test(name))
        throw new ApplicationError(
          "invalid_input",
          "Choose a name between 1 and 40 characters",
          400,
        );
      const inviteHash = await guestTokenHash(raw),
        hash = await guestTokenHash(credential);
      return transact(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${hash},740060))`);
        const existing = (
          await tx.execute<{ owner: string; party: string | null; valid: boolean }>(
            sql`SELECT g.owner_id AS owner,g.party_id::text AS party,g.revoked_at IS NULL AND g.expires_at>clock_timestamp() AS valid FROM guest_sessions g JOIN users u ON u.id=g.owner_id AND u.kind='guest' AND NOT u.disabled WHERE g.token_hash=${hash} FOR UPDATE OF g`,
          )
        ).rows[0];
        const party = (
          await tx.execute<{ id: string; host: string; settings: PartySettings; joins: number }>(
            sql`SELECT p.id::text,p.host_owner_id AS host,p.settings,p.guest_joins AS joins FROM parties p JOIN users h ON h.id=p.host_owner_id AND NOT h.disabled WHERE p.invite_hash=${inviteHash} AND p.disbanded_at IS NULL FOR UPDATE OF p`,
          )
        ).rows[0];
        if (!party) throw missing();
        if (!(await capabilitiesInTransaction(tx, party.host)).hostGuests)
          throw new ApplicationError("entitlement_required", "Guest hosting is unavailable", 403);
        if (existing) {
          if (existing.party !== party.id || !existing.valid)
            throw new ApplicationError("unauthenticated", "Guest session expired or revoked", 401);
          if (
            (
              await tx.execute(
                sql`SELECT 1 FROM party_members WHERE party_id=${party.id}::uuid AND owner_id=${existing.owner}`,
              )
            ).rows.length
          )
            return snapshot(tx, party.id);
        }
        if (
          party.settings.accessMode !== "guests_allowed" ||
          party.settings.admissionLocked ||
          (!existing && party.joins >= 32)
        )
          throw new ApplicationError("forbidden", "Party is not accepting guests", 403);
        const cap = party.settings.mode === "showdown" ? 2 : 8;
        const seat = (
          await tx.execute<{ n: number }>(
            sql`SELECT COALESCE(min(n),0)::int AS n FROM generate_series(1,${cap}) n WHERE NOT EXISTS(SELECT 1 FROM party_members WHERE party_id=${party.id}::uuid AND seat=n)`,
          )
        ).rows[0].n;
        if (!seat) throw conflict("Party is full");
        const owner = existing?.owner ?? crypto.randomUUID();
        if (!existing)
          await tx.execute(
            sql`INSERT INTO users(id,participant_id,display_name,kind) VALUES(${owner},${owner}::uuid,${name},'guest')`,
          );
        await tx.execute(
          sql`INSERT INTO party_members(party_id,owner_id,seat) VALUES(${party.id}::uuid,${owner},${seat})`,
        );
        if (!existing) {
          await tx.execute(
            sql`INSERT INTO guest_sessions(token_hash,owner_id,party_id,expires_at) VALUES(${hash},${owner},${party.id}::uuid,clock_timestamp()+interval '24 hours')`,
          );
          await tx.execute(
            sql`UPDATE parties SET guest_joins=guest_joins+1 WHERE id=${party.id}::uuid`,
          );
        }
        await reset(tx, party.id);
        return snapshot(tx, party.id);
      });
    },
    async mutate(who, id, key, action, body) {
      return command(
        who,
        `${action}:${id}`,
        key,
        body,
        async (tx) => {
          await lockParty(tx, id, who.userId);
          await reconcileParty(tx, id);
          const p = await lockParty(tx, id, who.userId);
          if (action === "settings") {
            const s = normalizePartySettings(body);
            if (p.current) throw conflict("Match settings are fixed during a round");
            if (
              p.host !== who.userId &&
              (p.settings.rules.settingsEditors !== "everyone" ||
                s.rules.settingsEditors !== p.settings.rules.settingsEditors ||
                s.accessMode !== p.settings.accessMode ||
                s.admissionLocked !== p.settings.admissionLocked)
            )
              throw new ApplicationError(
                "forbidden",
                "Only the host can change lobby permissions",
                403,
              );
            if (s.accessMode === "guests_allowed" && !guestCreation)
              throw new ApplicationError(
                "guest_hosting_paused",
                "Guest hosting is temporarily paused",
                409,
              );
            await hosting(tx, p.host, s.accessMode);
            await validateSelectedMatchProblem(tx, p.host, s);
            const count = (
              await tx.execute<{ n: number }>(
                sql`SELECT count(*)::int AS n FROM party_members WHERE party_id=${id}::uuid`,
              )
            ).rows[0].n;
            if (count > (s.mode === "showdown" ? 2 : 8))
              throw conflict("Too many players for this mode");
            if (
              s.accessMode === "accounts_only" &&
              (
                await tx.execute(
                  sql`SELECT 1 FROM party_members pm JOIN users u ON u.id=pm.owner_id WHERE pm.party_id=${id}::uuid AND u.kind='guest' LIMIT 1`,
                )
              ).rows.length
            )
              throw conflict("Remove guests before disabling guest access");
            const changed =
              (
                await tx.execute(
                  sql`SELECT 1 FROM parties WHERE id=${id}::uuid AND settings IS DISTINCT FROM ${JSON.stringify(s)}::jsonb`,
                )
              ).rows.length > 0;
            if (changed) {
              await tx.execute(
                sql`UPDATE parties SET settings=${JSON.stringify(s)}::jsonb WHERE id=${id}::uuid`,
              );
              await reset(tx, id);
            }
          } else if (action === "ready") {
            if (typeof body !== "boolean") throw conflict("Ready is required");
            if (p.current) throw conflict("A round is active");
            const changed = await tx.execute(
              sql`UPDATE party_members SET ready=${body} WHERE party_id=${id}::uuid AND owner_id=${who.userId} AND ready IS DISTINCT FROM ${body} RETURNING owner_id`,
            );
            if (changed.rows.length) {
              await tx.execute(
                sql`UPDATE parties SET countdown_ends_at=NULL,queue_error=NULL,version=version+1 WHERE id=${id}::uuid`,
              );
              if (body) await scheduleIfReady(tx, id);
            }
          } else if (action === "start") {
            if (p.host !== who.userId)
              throw new ApplicationError("forbidden", "Only the host can start", 403);
            if (p.current) throw conflict("A round is already active");
            if (p.latest) throw conflict("Ready players to start the next round");
            try {
              await startRound(tx, id, p);
            } catch (error) {
              if (classifyDatabaseError(error) === "lock_timeout")
                throw conflict("Party is updating. Try again.");
              throw error;
            }
          } else if (action === "disband") {
            if (p.host !== who.userId)
              throw new ApplicationError("forbidden", "Only the host can disband", 403);
            if (p.current) throw conflict("Cannot disband during a round");
            await tx.execute(
              sql`UPDATE parties SET disbanded_at=clock_timestamp(),countdown_ends_at=NULL,version=version+1 WHERE id=${id}::uuid`,
            );
            await tx.execute(sql`DELETE FROM party_members WHERE party_id=${id}::uuid`);
          } else if (action === "leave") {
            if (p.current) {
              const active = (
                await tx.execute<{ state: string }>(
                  sql`SELECT state FROM matches WHERE id=${p.current}::uuid FOR UPDATE`,
                )
              ).rows[0];
              const changed =
                active && active.state !== "completed" && active.state !== "cancelled"
                  ? await tx.execute(
                      sql`UPDATE match_participants SET forfeited=true WHERE match_id=${p.current}::uuid AND owner_id=${who.userId} AND NOT forfeited RETURNING owner_id`,
                    )
                  : null;
              if (changed?.rows.length) {
                await tx.execute(
                  sql`DELETE FROM match_reservations WHERE match_id=${p.current}::uuid AND owner_id=${who.userId}`,
                );
                const remaining = (
                  await tx.execute<{ n: number; winner: string | null }>(
                    sql`SELECT count(DISTINCT COALESCE(competitor_id,owner_id))::int AS n,min(COALESCE(competitor_id,owner_id)) AS winner FROM match_participants WHERE match_id=${p.current}::uuid AND NOT forfeited`,
                  )
                ).rows[0];
                if (remaining.n === 1)
                  await finishMatch(tx, p.current, "win", remaining.winner, "forfeit");
                else if (remaining.n === 0)
                  await finishMatch(tx, p.current, "cancelled", null, "forfeit_without_opponent");
                else await reconcileMatch(tx, p.current);
                await matchEvent(
                  tx,
                  p.current,
                  remaining.n <= 1 ? "match.completed" : "match.updated",
                );
              }
            }
            await tx.execute(
              sql`DELETE FROM party_members WHERE party_id=${id}::uuid AND owner_id=${who.userId}`,
            );
            await reset(tx, id);
            if (p.host === who.userId) await transferHost(tx, id, p.settings);
            await tx.execute(
              sql`UPDATE parties SET disbanded_at=clock_timestamp() WHERE id=${id}::uuid AND NOT EXISTS(SELECT 1 FROM party_members WHERE party_id=${id}::uuid)`,
            );
          }
          return snapshot(tx, id);
        },
        id,
      );
    },
    async heartbeat(who, windowId) {
      if (!uuid.test(windowId)) throw new ApplicationError("invalid_input", "Invalid window", 400);
      return transact(async (tx) => {
        await lockMatchOwner(tx, who);
        await validateGuest(tx, who);
        const prior = (
          await tx.execute<{ id: string }>(
            sql`SELECT party_id::text AS id FROM party_members WHERE owner_id=${who.userId}`,
          )
        ).rows[0];
        if (prior) await reconcileParty(tx, prior.id);
        await tx.execute(
          sql`DELETE FROM platform_presence_leases WHERE ctid IN (SELECT ctid FROM platform_presence_leases WHERE expires_at<=clock_timestamp()-interval '5 minutes' LIMIT 128)`,
        );
        const count = (
          await tx.execute<{ n: number; known: boolean }>(
            sql`SELECT count(*)::int AS n,COALESCE(bool_or(window_id=${windowId}::uuid),false) AS known FROM platform_presence_leases WHERE owner_id=${who.userId} AND expires_at>clock_timestamp()`,
          )
        ).rows[0];
        if (count.n >= 16 && !count.known)
          throw new ApplicationError("rate_limited", "Too many active windows", 429);
        await tx.execute(
          sql`INSERT INTO platform_presence_leases(owner_id,window_id,expires_at) VALUES(${who.userId},${windowId}::uuid,clock_timestamp()+interval '90 seconds') ON CONFLICT(owner_id,window_id) DO UPDATE SET expires_at=excluded.expires_at`,
        );
        await tx.execute(
          sql`UPDATE party_members SET last_seen_at=clock_timestamp() WHERE owner_id=${who.userId}`,
        );
        const row = (
          await tx.execute<{ id: string }>(
            sql`SELECT party_id::text AS id FROM party_members WHERE owner_id=${who.userId}`,
          )
        ).rows[0];
        if (row) await reconcileParty(tx, row.id);
        return {
          party:
            row &&
            (
              await tx.execute(
                sql`SELECT 1 FROM party_members WHERE party_id=${row.id}::uuid AND owner_id=${who.userId}`,
              )
            ).rows.length
              ? await snapshot(tx, row.id)
              : null,
        };
      });
    },
  };
  const wake = async (id: string | undefined) => {
    if (!id || !uuid.test(id)) return;
    try {
      await coordinator.wake(parseInt(id.slice(0, 8), 16) % shards);
    } catch {
      /* Periodic recovery discovers committed deadlines. */
    }
  };
  return {
    ...repo,
    async create(who, key, settings) {
      const value = await repo.create(who, key, settings);
      await wake((value as { party: { id: string } }).party.id);
      return value;
    },
    async join(who, key, token) {
      const value = await repo.join(who, key, token);
      await wake((value as { id: string }).id);
      return value;
    },
    async joinGuest(token, credential, name) {
      const value = await repo.joinGuest(token, credential, name);
      await wake((value as { id: string }).id);
      return value;
    },
    async mutate(who, id, key, action, body) {
      const value = await repo.mutate(who, id, key, action, body);
      await wake(id);
      return value;
    },
    async heartbeat(who, windowId) {
      const value = await repo.heartbeat(who, windowId);
      await wake((value as { party: { id: string } | null }).party?.id);
      return value;
    },
  };
}
