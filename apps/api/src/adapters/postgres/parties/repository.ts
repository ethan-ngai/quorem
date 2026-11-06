/** @file repository.ts @description Transactional party commands and snapshots. @module parties */
import { sql } from "drizzle-orm";
import type { ConnectionScope, Transaction } from "@quorem/database/core";
import {
  activateDeadline,
  type Receipts,
  type Coordinator,
} from "../../../modules/events/scheduling/scheduling.ts";
import { ApplicationError } from "../../../application/error.ts";
import { validGuestToken, guestTokenHash } from "../../../modules/identity/guest/credentials.ts";
import { consumePrearm } from "../events/scheduling/prearm.ts";
import { capabilitiesInTransaction } from "../access/repository.ts";
import type { Principal } from "../../../modules/identity/model.ts";
import {
  normalizePartySettings,
  type Parties,
  type PartySettings,
} from "../../../modules/parties/model.ts";
import {
  lockMatchOwner,
  hosting,
  start,
  type MatchRecord,
} from "../matches/lifecycle/repository.ts";
import { digest, fingerprint, inviteCipher, token } from "../matches/lifecycle/crypto.ts";
import { validateSelectedMatchProblem } from "../matches/selection/repository.ts";
import { matchEvent, finishMatch, reconcileMatch } from "../matches/reconcile/repository.ts";

type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const options = { statementTimeoutMs: 5000, lockTimeoutMs: 1000 };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const missing = () => new ApplicationError("not_found", "Party not found", 404);
const conflict = (message: string) => new ApplicationError("invalid_transition", message, 409);
const online = sql`EXISTS (SELECT 1 FROM platform_presence_leases l WHERE l.owner_id=pm.owner_id AND l.expires_at>clock_timestamp()) OR EXISTS (SELECT 1 FROM realtime_presence_leases l WHERE l.subject=pm.owner_id AND l.expires_at>clock_timestamp())`;
async function lockParty(tx: Transaction, id: string, owner: string) {
  if (!uuid.test(id)) throw missing();
  const row = (
    await tx.execute<{
      host: string;
      settings: PartySettings;
      current: string | null;
      latest: string | null;
    }>(
      sql`SELECT p.host_owner_id AS host,p.settings,p.current_match_id::text AS current,p.latest_match_id::text AS latest FROM parties p JOIN party_members pm ON pm.party_id=p.id AND pm.owner_id=${owner} WHERE p.id=${id}::uuid AND p.disbanded_at IS NULL FOR UPDATE OF p`,
    )
  ).rows[0];
  if (!row) throw missing();
  return row;
}
async function snapshot(tx: Transaction, id: string) {
  const row = (
    await tx.execute<{ data: unknown }>(
      sql`SELECT jsonb_build_object('id',p.id,'version',p.version::text,'hostUserId',h.participant_id,'settings',p.settings,'currentMatchId',p.current_match_id,'latestMatchId',p.latest_match_id,'countdownEndsAt',p.countdown_ends_at,'members',COALESCE((SELECT jsonb_agg(jsonb_build_object('userId',u.participant_id,'displayName',u.display_name,'ready',pm.ready,'online',(${online}),'joinedAt',pm.joined_at) ORDER BY pm.seat) FROM party_members pm JOIN users u ON u.id=pm.owner_id WHERE pm.party_id=p.id),'[]'::jsonb)) AS data FROM parties p JOIN users h ON h.id=p.host_owner_id WHERE p.id=${id}::uuid`,
    )
  ).rows[0];
  if (!row) throw missing();
  return row.data;
}
async function reset(tx: Transaction, id: string) {
  await tx.execute(sql`UPDATE party_members SET ready=false WHERE party_id=${id}::uuid`);
  await tx.execute(
    sql`UPDATE parties SET countdown_ends_at=NULL,version=version+1 WHERE id=${id}::uuid`,
  );
}
export async function startRound(
  tx: Transaction,
  id: string,
  p: { host: string; settings: PartySettings },
) {
  const members = (
    await tx.execute<{ owner: string; seat: number; ready: boolean; online: boolean }>(
      sql`SELECT pm.owner_id AS owner,pm.seat,pm.ready,(${online}) AS online FROM party_members pm WHERE pm.party_id=${id}::uuid ORDER BY pm.seat`,
    )
  ).rows;
  const required =
    p.settings.mode === "showdown"
      ? members.length === 2
      : members.length >= 2 && members.length <= 8;
  if (!required || members.some((m) => !m.ready || !m.online))
    throw conflict("All players must be online and ready");
  await hosting(tx, p.host, p.settings.accessMode);
  // Co-locate party and round deadlines on the same durable scheduler shard.
  const match = id.slice(0, 8) + crypto.randomUUID().slice(8),
    s = p.settings;
  await tx.execute(
    sql`INSERT INTO matches(id,party_id,share_code_after_match,host_owner_id,invite_hash,expires_at,duration_minutes,state,mode,difficulties,selected_problem_version_id,rules,access_mode,admission_locked,question_filters) VALUES(${match}::uuid,${id}::uuid,${s.shareCodeAfterMatch},${p.host},${await digest(token())},clock_timestamp()+interval '24 hours',${s.durationMinutes},'waiting',${s.mode},ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(s.difficulties)}::jsonb)),NULLIF(${s.selectedProblemVersionId ?? ""},'')::uuid,${JSON.stringify(s.rules)}::jsonb,${s.accessMode},${s.admissionLocked},${JSON.stringify(s.questionFilters)}::jsonb)`,
  );
  for (const member of members) {
    await tx.execute(
      sql`INSERT INTO match_participants(match_id,owner_id,seat,ready) VALUES(${match}::uuid,${member.owner},${member.seat},true)`,
    );
    await tx.execute(
      sql`INSERT INTO match_reservations(owner_id,match_id) VALUES(${member.owner},${match}::uuid)`,
    );
  }
  const record: MatchRecord = {
    host: p.host,
    state: "waiting",
    mode: s.mode,
    started: false,
    outcome: null,
    access: s.accessMode,
    settings: s,
  };
  await start(tx, match, record);
  await matchEvent(tx, match, "match.updated");
  await tx.execute(
    sql`UPDATE parties SET current_match_id=${match}::uuid,countdown_ends_at=NULL,version=version+1 WHERE id=${id}::uuid`,
  );
}
/** Reconciles presence, completed rounds and countdown under the party lock. */
export async function reconcileParty(tx: Transaction, id: string): Promise<void> {
  if (!uuid.test(id)) return;
  const p = (
    await tx.execute<{
      host: string;
      settings: PartySettings;
      current: string | null;
      latest: string | null;
      due: boolean;
    }>(
      sql`SELECT host_owner_id AS host,settings,current_match_id::text AS current,latest_match_id::text AS latest,countdown_ends_at<=clock_timestamp() AS due FROM parties WHERE id=${id}::uuid AND disbanded_at IS NULL FOR UPDATE`,
    )
  ).rows[0];
  if (!p) return;
  await tx.execute(
    sql`UPDATE party_members pm SET last_seen_at=clock_timestamp() WHERE pm.party_id=${id}::uuid AND (${online}) AND EXISTS(SELECT 1 FROM realtime_presence_leases l WHERE l.subject=pm.owner_id AND l.expires_at>clock_timestamp())`,
  );
  const offline = await tx.execute(
    sql`UPDATE party_members pm SET ready=false WHERE pm.party_id=${id}::uuid AND pm.ready AND NOT (${online}) RETURNING owner_id`,
  );
  const removed = await tx.execute(
    sql`DELETE FROM party_members pm WHERE pm.party_id=${id}::uuid AND pm.last_seen_at<=clock_timestamp()-interval '5 minutes' AND NOT (${online}) RETURNING owner_id`,
  );
  if (offline.rows.length || removed.rows.length) await reset(tx, id);
  await tx.execute(
    sql`UPDATE parties p SET host_owner_id=COALESCE((SELECT pm.owner_id FROM party_members pm WHERE pm.party_id=p.id AND (${online}) ORDER BY pm.joined_at,pm.owner_id LIMIT 1),p.host_owner_id) WHERE p.id=${id}::uuid AND NOT EXISTS(SELECT 1 FROM party_members WHERE party_id=p.id AND owner_id=p.host_owner_id)`,
  );
  const empty = await tx.execute(
    sql`UPDATE parties p SET disbanded_at=clock_timestamp(),countdown_ends_at=NULL,version=version+1 WHERE p.id=${id}::uuid AND NOT EXISTS(SELECT 1 FROM party_members WHERE party_id=p.id) RETURNING id`,
  );
  if (empty.rows.length) return;
  if (p.current) {
    const done = (
      await tx.execute(
        sql`SELECT 1 FROM matches WHERE id=${p.current}::uuid AND state IN ('completed','cancelled')`,
      )
    ).rows.length;
    if (done) {
      await tx.execute(
        sql`UPDATE parties SET latest_match_id=current_match_id,current_match_id=NULL,countdown_ends_at=NULL,version=version+1 WHERE id=${id}::uuid`,
      );
      await tx.execute(sql`UPDATE party_members SET ready=false WHERE party_id=${id}::uuid`);
      return;
    }
  }
  if (p.due && !p.current && !offline.rows.length && !removed.rows.length) {
    await tx.execute(sql`SAVEPOINT party_round_start`);
    try {
      const latest = (
        await tx.execute<{ host: string; settings: PartySettings }>(
          sql`SELECT host_owner_id AS host,settings FROM parties WHERE id=${id}::uuid`,
        )
      ).rows[0];
      await startRound(tx, id, latest);
      await tx.execute(sql`RELEASE SAVEPOINT party_round_start`);
    } catch (error) {
      await tx.execute(sql`ROLLBACK TO SAVEPOINT party_round_start`);
      await tx.execute(sql`RELEASE SAVEPOINT party_round_start`);
      if (!(error instanceof ApplicationError)) throw error;
      await reset(tx, id);
    }
  }
}
async function scheduleIfReady(tx: Transaction, id: string) {
  await tx.execute(
    sql`UPDATE parties p SET countdown_ends_at=clock_timestamp()+interval '5 seconds' WHERE p.id=${id}::uuid AND p.current_match_id IS NULL AND p.latest_match_id IS NOT NULL AND (SELECT count(*) FROM party_members WHERE party_id=p.id)>=2 AND (p.settings->>'mode'<>'showdown' OR (SELECT count(*) FROM party_members WHERE party_id=p.id)=2) AND NOT EXISTS(SELECT 1 FROM party_members pm WHERE pm.party_id=p.id AND (NOT pm.ready OR NOT (${online})))`,
  );
}
export function partyRepository(
  run: Run,
  inviteKey: Uint8Array,
  coordinator: Coordinator,
  shards: number,
  receipts: Receipts,
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
          if (receipt) await consumePrearm(tx, receipt.id, receipt.shard);
          return route === "create" ? cipher.open(prior.response) : prior.response;
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
    async read(who, id) {
      return transact(async (tx) => {
        await lockParty(tx, id, who.userId);
        await reconcileParty(tx, id);
        await lockParty(tx, id, who.userId);
        return snapshot(tx, id);
      });
    },
    async create(who, key, input) {
      const s = normalizePartySettings(input),
        id = crypto.randomUUID();
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
      const hash = await digest(raw);
      return transact(async (tx) => {
        const row = (
          await tx.execute<{ data: unknown }>(
            sql`SELECT jsonb_build_object('id',p.id,'settings',p.settings,'participantCount',(SELECT count(*) FROM party_members WHERE party_id=p.id),'capacity',CASE WHEN p.settings->>'mode'='showdown' THEN 2 ELSE 8 END) AS data FROM parties p JOIN users h ON h.id=p.host_owner_id AND NOT h.disabled WHERE p.invite_hash=${hash} AND p.disbanded_at IS NULL`,
          )
        ).rows[0];
        if (!row) throw missing();
        return row.data;
      });
    },
    async join(who, key, raw) {
      if (who.kind === "guest")
        throw new ApplicationError("forbidden", "Use guest invitation", 403);
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
        const party = (
          await tx.execute<{ id: string; host: string; settings: PartySettings; joins: number }>(
            sql`SELECT id::text,host_owner_id AS host,settings,guest_joins AS joins FROM parties WHERE invite_hash=${inviteHash} AND disbanded_at IS NULL FOR UPDATE`,
          )
        ).rows[0];
        if (!party) throw missing();
        const existing = (
          await tx.execute<{ owner: string; party: string | null; valid: boolean }>(
            sql`SELECT owner_id AS owner,party_id::text AS party,revoked_at IS NULL AND expires_at>clock_timestamp() AND last_seen_at>clock_timestamp()-interval '2 hours' AS valid FROM guest_sessions WHERE token_hash=${hash} FOR UPDATE`,
          )
        ).rows[0];
        if (existing) {
          if (existing.party !== party.id || !existing.valid)
            throw new ApplicationError("unauthenticated", "Guest session expired or revoked", 401);
          await lockParty(tx, party.id, existing.owner);
          return snapshot(tx, party.id);
        }
        if (
          party.settings.accessMode !== "guests_allowed" ||
          party.settings.admissionLocked ||
          party.joins >= 32
        )
          throw new ApplicationError("forbidden", "Party is not accepting guests", 403);
        if (!(await capabilitiesInTransaction(tx, party.host)).hostGuests)
          throw new ApplicationError("entitlement_required", "Guest hosting is unavailable", 403);
        const cap = party.settings.mode === "showdown" ? 2 : 8;
        const seat = (
          await tx.execute<{ n: number }>(
            sql`SELECT COALESCE(min(n),0)::int AS n FROM generate_series(1,${cap}) n WHERE NOT EXISTS(SELECT 1 FROM party_members WHERE party_id=${party.id}::uuid AND seat=n)`,
          )
        ).rows[0].n;
        if (!seat) throw conflict("Party is full");
        const owner = crypto.randomUUID();
        await tx.execute(
          sql`INSERT INTO users(id,participant_id,display_name,kind) VALUES(${owner},${owner}::uuid,${name},'guest')`,
        );
        await tx.execute(
          sql`INSERT INTO party_members(party_id,owner_id,seat) VALUES(${party.id}::uuid,${owner},${seat})`,
        );
        await tx.execute(
          sql`INSERT INTO guest_sessions(token_hash,owner_id,party_id,expires_at) VALUES(${hash},${owner},${party.id}::uuid,clock_timestamp()+interval '24 hours')`,
        );
        await tx.execute(
          sql`UPDATE parties SET guest_joins=guest_joins+1 WHERE id=${party.id}::uuid`,
        );
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
          await reconcileParty(tx, id);
          const p = await lockParty(tx, id, who.userId);
          if (action === "settings") {
            if (p.host !== who.userId)
              throw new ApplicationError("forbidden", "Only the host can change settings", 403);
            const s = normalizePartySettings(body);
            await hosting(tx, who.userId, s.accessMode);
            await validateSelectedMatchProblem(tx, who.userId, s);
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
            await tx.execute(
              sql`UPDATE party_members SET ready=${body} WHERE party_id=${id}::uuid AND owner_id=${who.userId}`,
            );
            await tx.execute(
              sql`UPDATE parties SET countdown_ends_at=NULL,version=version+1 WHERE id=${id}::uuid`,
            );
            if (body) await scheduleIfReady(tx, id);
          } else if (action === "start") {
            if (p.host !== who.userId)
              throw new ApplicationError("forbidden", "Only the host can start", 403);
            if (p.current) throw conflict("A round is already active");
            await startRound(tx, id, p);
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
                    sql`SELECT count(*)::int AS n,min(owner_id) AS winner FROM match_participants WHERE match_id=${p.current}::uuid AND NOT forfeited`,
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
            if (p.host === who.userId) {
              await tx.execute(
                sql`UPDATE parties SET host_owner_id=COALESCE((SELECT pm.owner_id FROM party_members pm WHERE pm.party_id=${id}::uuid AND (${online}) ORDER BY pm.joined_at,pm.owner_id LIMIT 1),host_owner_id) WHERE id=${id}::uuid`,
              );
            }
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
        await tx.execute(
          sql`DELETE FROM platform_presence_leases WHERE ctid IN (SELECT ctid FROM platform_presence_leases WHERE expires_at<=clock_timestamp() LIMIT 128)`,
        );
        const count = (
          await tx.execute<{ n: number; known: boolean }>(
            sql`SELECT count(*)::int AS n,COALESCE(bool_or(window_id=${windowId}::uuid),false) AS known FROM platform_presence_leases WHERE owner_id=${who.userId}`,
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
