/** @file repository.ts @description Transactional match lifecycle and idempotency. @module matches */
import { sql } from "drizzle-orm";
import type { ConnectionScope, Transaction } from "@quorem/database/core";
import { ApplicationError } from "../../../../application/error.ts";
import type { Principal } from "../../../../modules/identity/model.ts";
import {
  normalizeSettings,
  type Lifecycle,
  type Settings,
} from "../../../../modules/matches/lifecycle/model.ts";
import {
  activateDeadline,
  type Coordinator,
  type Receipts,
} from "../../../../modules/events/scheduling/scheduling.ts";
import { consumePrearm } from "../../events/scheduling/prearm.ts";
import { capabilitiesInTransaction } from "../../access/repository.ts";
import { lookupGuestInTransaction } from "../../identity/guest.ts";
import { readCandidates } from "../../problems/queries/repository.ts";
import type { CandidateCriteria } from "../../../../modules/problems/model.ts";
import { finishMatch, matchEvent, reconcileMatch } from "../reconcile/repository.ts";
import { digest, fingerprint, inviteCipher, settingsBody, token } from "./crypto.ts";
type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const options = { statementTimeoutMs: 5000, lockTimeoutMs: 1000 };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const missing = () => new ApplicationError("not_found", "Match not found", 404);
const transition = (message: string) => new ApplicationError("invalid_transition", message, 409);
export type MatchRecord = {
  host: string;
  state: string;
  mode: string;
  started: boolean;
  outcome: unknown;
  access: string;
  settings: Settings;
};
/** Locks the current owner before the aggregate. */
export async function lockMatchOwner(tx: Transaction, who: Principal) {
  const row = (
    await tx.execute<{ kind: string }>(
      sql`SELECT kind FROM users WHERE id=${who.userId} AND NOT disabled FOR NO KEY UPDATE`,
    )
  ).rows[0];
  if (!row || (row.kind === "guest") !== (who.kind === "guest")) throw missing();
}
/** Caller must lock the owner first for mutating commands. */
export async function lockMatch(tx: Transaction, id: string): Promise<MatchRecord> {
  if (!uuid.test(id)) throw missing();
  const row = (
    await tx.execute<{
      host: string;
      state: string;
      mode: string;
      started: boolean;
      outcome: unknown;
      access: string;
      settings: Settings;
    }>(
      sql`SELECT host_owner_id AS host,state,mode,started_at IS NOT NULL AS started,outcome,access_mode AS access,jsonb_strip_nulls(jsonb_build_object('questionFilters',question_filters,'admissionLocked',admission_locked,'accessMode',access_mode,'mode',mode,'difficulties',difficulties,'selectedProblemVersionId',selected_problem_version_id::text,'rules',rules,'difficulty',difficulties[1],'durationMinutes',duration_minutes)) AS settings FROM matches WHERE id=${id}::uuid FOR UPDATE`,
    )
  ).rows[0];
  if (!row) throw missing();
  return row;
}
/** Revalidates scoped guest credentials and current membership under the match lock. */
export async function requireMatchMember(tx: Transaction, who: Principal, id: string) {
  if (who.kind === "guest") {
    if (who.scope.kind !== "match" || who.scope.matchId !== id) throw missing();
    const actual = await lookupGuestInTransaction(tx, "match", who.sessionId);
    if (
      !actual ||
      actual.userId !== who.userId ||
      actual.scope.kind !== "match" ||
      actual.scope.matchId !== id
    )
      throw missing();
  }
  if (
    !(
      await tx.execute(
        sql`SELECT 1 FROM match_participants WHERE match_id=${id}::uuid AND owner_id=${who.userId}`,
      )
    ).rows.length
  )
    throw missing();
}
/** Caller has authorized membership and holds the aggregate lock. */
export async function matchSnapshot(tx: Transaction, id: string, owner: string): Promise<unknown> {
  const row = (
    await tx.execute<{ data: unknown }>(
      sql`SELECT jsonb_strip_nulls(jsonb_build_object('id',m.id,'version',m.version::text,'state',m.state,'serverNow',clock_timestamp(),'hostUserId',h.participant_id,'expiresAt',m.expires_at,'questionFilters',m.question_filters,'admissionLocked',m.admission_locked,'accessMode',m.access_mode,'mode',m.mode,'difficulties',m.difficulties,'selectedProblemVersionId',m.selected_problem_version_id,'rules',m.rules,'difficulty',m.difficulties[1],'durationMinutes',m.duration_minutes,'startedAt',m.started_at,'deadline',m.deadline,'finalizingAt',m.finalizing_at,'problemVersionId',m.problem_version_id,'outcome',m.outcome,'participants',COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('userId',u.participant_id,'displayName',u.display_name,'ready',p.ready,'presence',p.presence,'workspaceId',CASE WHEN p.owner_id=${owner} THEN p.workspace_id END,'submissionState',NULLIF(p.submission_state,''),'forfeited',p.forfeited,'guest',u.kind='guest','bestScore',CASE WHEN m.started_at IS NOT NULL THEN jsonb_build_object('passed',p.best_passed,'total',CASE WHEN v.odyssey IS NOT NULL THEN (SELECT count(*) FROM problem_odyssey_cases WHERE version_id=v.id) ELSE (SELECT count(*) FROM problem_test_cases WHERE version_id=v.id) END) END)) ORDER BY p.seat) FROM match_participants p JOIN users u ON u.id=p.owner_id WHERE p.match_id=m.id),'[]'::jsonb),'ruleEvents',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'userId',u.participant_id,'kind',e.kind,'action','announce','occurredAt',e.occurred_at) ORDER BY e.occurred_at,e.id) FROM match_rule_events e JOIN users u ON u.id=e.owner_id WHERE e.match_id=m.id),'[]'::jsonb))) AS data FROM matches m JOIN users h ON h.id=m.host_owner_id LEFT JOIN problem_versions v ON v.id=m.problem_version_id WHERE m.id=${id}::uuid`,
    )
  ).rows[0];
  if (!row) throw missing();
  return row.data;
}
async function hosting(tx: Transaction, owner: string, mode: string) {
  const user = (
    await tx.execute<{ kind: string }>(
      sql`SELECT kind FROM users WHERE id=${owner} AND NOT disabled`,
    )
  ).rows[0];
  if (user?.kind !== "account")
    throw new ApplicationError("forbidden", "An account is required to host", 403);
  if (mode === "guests_allowed" && !(await capabilitiesInTransaction(tx, owner)).hostGuests)
    throw new ApplicationError(
      "entitlement_required",
      "Guest hosting requires an eligible plan",
      403,
    );
}
async function selected(tx: Transaction, owner: string, s: Settings) {
  if (!s.selectedProblemVersionId) return;
  if (
    !(
      await tx.execute(
        sql`SELECT 1 FROM problem_versions v JOIN problems p ON p.id=v.problem_id WHERE v.id::text=${s.selectedProblemVersionId} AND p.current_version_id=v.id AND v.sealed AND (p.owner_id IS NULL OR p.owner_id=${owner})`,
      )
    ).rows.length
  )
    throw new ApplicationError("invalid_input", "Problem not found", 400);
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => JSON.stringify(k) + ":" + stable(v))
      .join(",")}}`;
  return JSON.stringify(value);
}
function choice<T>(items: readonly T[]): T {
  const bound = Math.floor(0x100000000 / items.length) * items.length;
  const n = new Uint32Array(1);
  do crypto.getRandomValues(n);
  while (n[0] >= bound);
  return items[n[0] % items.length];
}
async function start(tx: Transaction, id: string, m: MatchRecord) {
  await hosting(tx, m.host, m.access);
  await selected(tx, m.host, m.settings);
  const f = m.settings.questionFilters;
  const criteria: CandidateCriteria = {
    selectedVersionId: m.settings.selectedProblemVersionId,
    difficulty: m.settings.difficulties.join(","),
    type: (f.type ?? "") as "" | "classic" | "odyssey",
    sql: f.sql === "true" ? "true" : "false",
    topic: f.topic ?? "",
    company: f.company ?? "",
  };
  const available = await readCandidates(tx, { userId: m.host }, criteria);
  const permitted = (
    await tx.execute<{ id: string }>(
      sql`SELECT id::text AS id FROM problem_versions WHERE sealed AND id::text IN (SELECT jsonb_array_elements_text(${JSON.stringify(available.map((x) => x.id))}::jsonb))`,
    )
  ).rows;
  const allowed = new Set(permitted.map((x) => x.id));
  const candidates = available.filter((x) => allowed.has(x.id));
  if (!candidates.length)
    throw new ApplicationError(
      "no_matching_questions",
      "No questions match the selected filters",
      409,
    );
  const chosen = choice(candidates);
  const pinned = await tx.execute(
    sql`SELECT v.id FROM problem_versions v JOIN problems p ON p.id=v.problem_id WHERE v.id=${chosen.id}::uuid AND v.sealed AND p.current_version_id=v.id AND (p.owner_id IS NULL OR p.owner_id=${m.host}) FOR SHARE OF p,v`,
  );
  if (!pinned.rows.length)
    throw new ApplicationError(
      "no_matching_questions",
      "No questions match the selected filters",
      409,
    );
  const latest = await readCandidates(tx, { userId: m.host }, criteria);
  if (!latest.some((item) => item.id === chosen.id))
    throw new ApplicationError(
      "no_matching_questions",
      "No questions match the selected filters",
      409,
    );
  await tx.execute(
    sql`UPDATE matches SET state='active',problem_version_id=${chosen.id}::uuid,started_at=clock_timestamp(),deadline=clock_timestamp()+make_interval(mins=>duration_minutes) WHERE id=${id}::uuid`,
  );
  const people = (
    await tx.execute<{ owner: string }>(
      sql`SELECT owner_id AS owner FROM match_participants WHERE match_id=${id}::uuid ORDER BY seat`,
    )
  ).rows;
  for (const person of people) {
    const workspace = crypto.randomUUID();
    await tx.execute(
      sql`INSERT INTO workspaces(id,owner_id,problem_version_id,language,kind,match_id) VALUES(${workspace}::uuid,${person.owner},${chosen.id}::uuid,${chosen.sql ? "postgresql" : "python"},'match',${id}::uuid)`,
    );
    await tx.execute(
      sql`UPDATE match_participants SET workspace_id=${workspace}::uuid WHERE match_id=${id}::uuid AND owner_id=${person.owner}`,
    );
  }
}
export function matchLifecycle(
  run: Run,
  deps: {
    inviteKey: Uint8Array;
    receipts: Receipts;
    coordinator: Coordinator;
    shards: number;
    guestCreation: boolean;
  },
): Lifecycle {
  if (!Number.isInteger(deps.shards) || deps.shards < 1 || deps.shards > 256)
    throw new RangeError("Invalid shard count");
  const cipher = inviteCipher(deps.inviteKey);
  const shard = (id: string) => parseInt(id.slice(0, 8), 16) % deps.shards;
  const transact = <T>(f: (tx: Transaction) => Promise<T>) =>
    run((scope) => scope.transaction(options, f));
  async function command(
    who: Principal,
    route: string,
    key: string,
    body: unknown,
    action: (tx: Transaction) => Promise<unknown>,
    receipt?: { id: string; shard: number },
  ) {
    if (!key || new TextEncoder().encode(key).length > 128)
      throw new ApplicationError("invalid_input", "Idempotency-Key required", 400);
    const hash = await fingerprint(body);
    return transact(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${who.userId + ":" + route + ":" + key},740040))`,
      );
      await lockMatchOwner(tx, who);
      const prior = (
        await tx.execute<{ hash: string; response: unknown }>(
          sql`SELECT body_hash AS hash,response FROM match_idempotency WHERE owner_id=${who.userId} AND route=${route} AND key=${key} AND expires_at>clock_timestamp()`,
        )
      ).rows[0];
      if (prior) {
        if (prior.hash !== hash)
          throw new ApplicationError(
            "idempotency_conflict",
            "Key was used for a different command",
            409,
          );
        if (route !== "create" && (who.kind === "guest" || !route.startsWith("leave:"))) {
          const matchId = route.slice(route.indexOf(":") + 1);
          await lockMatch(tx, matchId);
          await requireMatchMember(tx, who, matchId);
        }
        if (receipt) await consumePrearm(tx, receipt.id, receipt.shard);
        return route === "create" ? cipher.open(prior.response) : prior.response;
      }
      const value = await action(tx);
      if (receipt) await consumePrearm(tx, receipt.id, receipt.shard);
      const stored = route === "create" ? await cipher.seal(value) : value;
      await tx.execute(
        sql`INSERT INTO match_idempotency(owner_id,route,key,body_hash,response,expires_at) VALUES(${who.userId},${route},${key},${hash},${JSON.stringify(stored)}::jsonb,clock_timestamp()+interval '24 hours') ON CONFLICT(owner_id,route,key) DO UPDATE SET body_hash=EXCLUDED.body_hash,response=EXCLUDED.response,expires_at=EXCLUDED.expires_at`,
      );
      return value;
    });
  }
  const arm = <T>(id: string, fn: (receipt: { id: string; shard: number }) => Promise<T>) =>
    activateDeadline(deps.receipts, deps.coordinator, shard(id), (fence) =>
      fn({ id: fence, shard: shard(id) }),
    );
  return {
    async create(who, key, input) {
      const s = normalizeSettings(input);
      if (s.accessMode === "guests_allowed" && !deps.guestCreation)
        throw new ApplicationError(
          "guest_hosting_paused",
          "Guest hosting is temporarily paused",
          409,
        );
      const id = crypto.randomUUID();
      return arm(id, (receipt) =>
        command(
          who,
          "create",
          key,
          settingsBody(s),
          async (tx) => {
            await hosting(tx, who.userId, s.accessMode);
            await selected(tx, who.userId, s);
            if (
              (await tx.execute(sql`SELECT 1 FROM match_reservations WHERE owner_id=${who.userId}`))
                .rows.length
            )
              throw new ApplicationError("user_busy", "Another match is active", 409);
            const secret = token(),
              hash = await digest(secret);
            await tx.execute(
              sql`INSERT INTO matches(id,host_owner_id,invite_hash,expires_at,duration_minutes,state,mode,difficulties,selected_problem_version_id,rules,access_mode,admission_locked,question_filters) VALUES(${id}::uuid,${who.userId},${hash},clock_timestamp()+interval '24 hours',${s.durationMinutes},'waiting',${s.mode},ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(s.difficulties)}::jsonb)),NULLIF(${s.selectedProblemVersionId ?? ""},'')::uuid,${JSON.stringify(s.rules)}::jsonb,${s.accessMode},${s.admissionLocked},${JSON.stringify(s.questionFilters)}::jsonb)`,
            );
            await tx.execute(
              sql`INSERT INTO match_participants(match_id,owner_id,seat) VALUES(${id}::uuid,${who.userId},1)`,
            );
            await tx.execute(
              sql`INSERT INTO match_reservations(owner_id,match_id) VALUES(${who.userId},${id}::uuid)`,
            );
            await matchEvent(tx, id, "match.updated");
            return { id, state: "waiting", inviteUrl: `/invite/${secret}` };
          },
          receipt,
        ),
      );
    },
    async read(who, id) {
      return transact(async (tx) => {
        await lockMatchOwner(tx, who);
        await lockMatch(tx, id);
        await requireMatchMember(tx, who, id);
        await reconcileMatch(tx, id);
        return matchSnapshot(tx, id, who.userId);
      });
    },
    async current(who) {
      return transact(async (tx) => {
        await lockMatchOwner(tx, who);
        const row = (
          await tx.execute<{ id: string }>(
            sql`SELECT r.match_id::text AS id FROM match_reservations r JOIN match_participants p ON p.match_id=r.match_id AND p.owner_id=r.owner_id WHERE r.owner_id=${who.userId} AND NOT p.forfeited`,
          )
        ).rows[0];
        if (!row) return null;
        await lockMatch(tx, row.id);
        await requireMatchMember(tx, who, row.id);
        await reconcileMatch(tx, row.id);
        const m = await lockMatch(tx, row.id);
        return m.outcome ? null : matchSnapshot(tx, row.id, who.userId);
      });
    },
    async mutate(who, id, key, action, input) {
      const body = action === "settings" ? normalizeSettings(input) : input;
      if (action === "ready" && typeof body !== "boolean")
        throw new ApplicationError("invalid_input", "Ready is required", 400);
      if (!uuid.test(id)) throw missing();
      const payload =
        action === "settings" ? settingsBody(body as Settings) : action === "ready" ? body : {};
      const perform = (receipt?: { id: string; shard: number }) =>
        command(
          who,
          `${action}:${id}`,
          key,
          payload,
          async (tx) => {
            let m = await lockMatch(tx, id);
            await requireMatchMember(tx, who, id);
            if (action !== "forfeit") {
              await reconcileMatch(tx, id);
              m = await lockMatch(tx, id);
            }
            const closed = m.outcome !== null;
            if (action === "settings") {
              const s = body as Settings;
              if (s.accessMode === "guests_allowed" && !deps.guestCreation)
                throw new ApplicationError(
                  "guest_hosting_paused",
                  "Guest hosting is temporarily paused",
                  409,
                );
              if (m.host !== who.userId)
                throw new ApplicationError("forbidden", "Only the host can change settings", 403);
              if (m.started || closed) throw transition("Match settings are fixed");
              const count = Number(
                (
                  await tx.execute<{ n: string }>(
                    sql`SELECT count(*)::text AS n FROM match_participants WHERE match_id=${id}::uuid`,
                  )
                ).rows[0].n,
              );
              if (count > (s.mode === "free-for-all" ? 8 : 2))
                throw transition("Too many players for this mode");
              await hosting(tx, who.userId, s.accessMode);
              await selected(tx, who.userId, s);
              if (
                s.accessMode === "accounts_only" &&
                (
                  await tx.execute(
                    sql`SELECT 1 FROM match_participants p JOIN users u ON u.id=p.owner_id WHERE p.match_id=${id}::uuid AND u.kind='guest' LIMIT 1`,
                  )
                ).rows.length
              )
                throw transition("Remove guests before disabling guest access");
              const before = { ...m.settings, admissionLocked: s.admissionLocked };
              if (stable(settingsBody(before)) === stable(settingsBody(s)))
                await tx.execute(
                  sql`UPDATE matches SET admission_locked=${s.admissionLocked} WHERE id=${id}::uuid`,
                );
              else {
                await tx.execute(
                  sql`UPDATE matches SET duration_minutes=${s.durationMinutes},mode=${s.mode},difficulties=ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(s.difficulties)}::jsonb)),selected_problem_version_id=NULLIF(${s.selectedProblemVersionId ?? ""},'')::uuid,rules=${JSON.stringify(s.rules)}::jsonb,access_mode=${s.accessMode},admission_locked=${s.admissionLocked},question_filters=${JSON.stringify(s.questionFilters)}::jsonb,state='waiting' WHERE id=${id}::uuid`,
                );
                await tx.execute(
                  sql`UPDATE match_participants SET ready=false WHERE match_id=${id}::uuid`,
                );
              }
            } else if (action === "ready") {
              if (!["waiting", "ready"].includes(m.state))
                throw transition("Match has started or closed");
              await tx.execute(
                sql`UPDATE match_participants SET ready=${body as boolean},presence='offline' WHERE match_id=${id}::uuid AND owner_id=${who.userId}`,
              );
              const counts = (
                await tx.execute<{ total: number; ready: number }>(
                  sql`SELECT count(*)::int AS total,count(*) FILTER(WHERE ready)::int AS ready FROM match_participants WHERE match_id=${id}::uuid`,
                )
              ).rows[0];
              if (m.mode === "showdown" && counts.total === 2 && counts.ready === 2)
                await start(tx, id, m);
              else
                await tx.execute(
                  sql`UPDATE matches SET state=${counts.ready ? "ready" : "waiting"} WHERE id=${id}::uuid`,
                );
            } else if (action === "start") {
              if (m.host !== who.userId)
                throw new ApplicationError("forbidden", "Only the host can start", 403);
              if (m.mode !== "free-for-all" || !["waiting", "ready"].includes(m.state))
                throw transition("Match cannot start");
              const c = (
                await tx.execute<{ total: number; ready: number }>(
                  sql`SELECT count(*)::int AS total,count(*) FILTER(WHERE ready)::int AS ready FROM match_participants WHERE match_id=${id}::uuid`,
                )
              ).rows[0];
              if (c.total < 2 || c.total !== c.ready) throw transition("All players must be ready");
              await start(tx, id, m);
            } else if (action === "leave") {
              if (!closed) {
                if (m.started)
                  await tx.execute(
                    sql`UPDATE match_participants SET presence='offline' WHERE match_id=${id}::uuid AND owner_id=${who.userId}`,
                  );
                else if (m.host === who.userId)
                  await finishMatch(tx, id, "cancelled", null, "host_left");
                else {
                  await tx.execute(
                    sql`UPDATE match_participants SET ready=false,presence='offline' WHERE match_id=${id}::uuid`,
                  );
                  await tx.execute(
                    sql`DELETE FROM match_reservations WHERE match_id=${id}::uuid AND owner_id=${who.userId}`,
                  );
                  await tx.execute(sql`UPDATE matches SET state='waiting' WHERE id=${id}::uuid`);
                }
              }
            } else if (action === "forfeit" && !closed) {
              if (!m.started)
                await finishMatch(tx, id, "cancelled", null, "forfeit_without_opponent");
              else {
                await tx.execute(
                  sql`UPDATE match_participants SET forfeited=true WHERE match_id=${id}::uuid AND owner_id=${who.userId}`,
                );
                await tx.execute(
                  sql`DELETE FROM match_reservations WHERE match_id=${id}::uuid AND owner_id=${who.userId}`,
                );
                const remaining = (
                  await tx.execute<{ n: number; winner: string | null }>(
                    sql`SELECT count(*)::int AS n,min(owner_id) AS winner FROM match_participants WHERE match_id=${id}::uuid AND NOT forfeited`,
                  )
                ).rows[0];
                if (remaining.n === 1)
                  await finishMatch(tx, id, "win", remaining.winner, "forfeit");
                else if (!remaining.n)
                  await finishMatch(tx, id, "cancelled", null, "forfeit_without_opponent");
                else await reconcileMatch(tx, id);
              }
            }
            m = await lockMatch(tx, id);
            if (!closed) await matchEvent(tx, id, m.outcome ? "match.completed" : "match.updated");
            const result = await matchSnapshot(tx, id, who.userId);
            if (action === "leave" && who.userId !== m.host && !m.started && !m.outcome) {
              await tx.execute(
                sql`DELETE FROM match_participants WHERE match_id=${id}::uuid AND owner_id=${who.userId}`,
              );
              const v = result as { participants: { userId: string }[] };
              const user = (
                await tx.execute<{ id: string }>(
                  sql`SELECT participant_id AS id FROM users WHERE id=${who.userId}`,
                )
              ).rows[0];
              v.participants = v.participants.filter((p) => p.userId !== user.id);
            }
            return result;
          },
          receipt,
        );
      return action === "ready" || action === "start" ? arm(id, perform) : perform();
    },
  };
}
