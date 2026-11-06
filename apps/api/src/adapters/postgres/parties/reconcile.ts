/** @file reconcile.ts @description Party presence and round transitions. @module parties */
import { sql } from "drizzle-orm";
import { classifyDatabaseError, type Transaction } from "@quorem/database/core";
import { ApplicationError } from "../../../application/error.ts";
import type { PartySettings } from "../../../modules/parties/model.ts";
import { capabilitiesInTransaction } from "../access/repository.ts";
import { hosting, start, type MatchRecord } from "../matches/lifecycle/repository.ts";
import { digest, token } from "../matches/lifecycle/crypto.ts";
import { reviewPending } from "../matches/review/pending.ts";
import { matchEvent } from "../matches/reconcile/repository.ts";
import { uuid, conflict, online, reset } from "./store.ts";
export async function startRound(
  tx: Transaction,
  id: string,
  p: { host: string; settings: PartySettings },
) {
  const members = (
    await tx.execute<{
      owner: string;
      seat: number;
      ready: boolean;
      online: boolean;
      kind: string;
      disabled: boolean;
    }>(
      sql`SELECT pm.owner_id AS owner,pm.seat,pm.ready,(${online}) AS online,u.kind,u.disabled FROM party_members pm JOIN users u ON u.id=pm.owner_id WHERE pm.party_id=${id}::uuid ORDER BY pm.seat FOR SHARE OF u NOWAIT`,
    )
  ).rows;
  const required =
    p.settings.mode === "showdown"
      ? members.length === 2
      : members.length >= 2 && members.length <= 8;
  if (!required || members.some((m) => !m.ready || !m.online))
    throw conflict("All players must be online and ready");
  await hosting(tx, p.host, p.settings.accessMode);
  for (const member of members) {
    if (member.disabled) throw conflict("A player is no longer eligible");
    if (member.kind === "guest") {
      const live = await tx.execute(
        sql`SELECT 1 FROM guest_sessions WHERE owner_id=${member.owner} AND party_id=${id}::uuid AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE NOWAIT`,
      );
      if (!live.rows.length) throw conflict("A guest session has expired");
    }
  }
  if (
    (
      await tx.execute(
        sql`SELECT 1 FROM match_reservations r JOIN party_members pm ON pm.owner_id=r.owner_id WHERE pm.party_id=${id}::uuid LIMIT 1`,
      )
    ).rows.length
  )
    throw new ApplicationError("user_busy", "A player is still in another match", 409);
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
    sql`UPDATE parties SET current_match_id=${match}::uuid,countdown_ends_at=NULL,queue_error=NULL,version=version+1 WHERE id=${id}::uuid`,
  );
}
export async function transferHost(tx: Transaction, id: string, settings: PartySettings) {
  const candidates = (
    await tx.execute<{ owner: string; online: boolean }>(
      sql`SELECT pm.owner_id AS owner,(${online}) AS online FROM party_members pm JOIN users u ON u.id=pm.owner_id WHERE pm.party_id=${id}::uuid AND u.kind='account' AND NOT u.disabled ORDER BY pm.joined_at,pm.owner_id`,
    )
  ).rows;
  let eligible = false,
    replacement: string | undefined;
  for (const candidate of candidates) {
    if (
      settings.accessMode === "guests_allowed" &&
      !(await capabilitiesInTransaction(tx, candidate.owner)).hostGuests
    )
      continue;
    eligible = true;
    if (candidate.online) {
      replacement = candidate.owner;
      break;
    }
  }
  if (replacement)
    await tx.execute(
      sql`UPDATE parties SET host_owner_id=${replacement},version=version+1 WHERE id=${id}::uuid`,
    );
  else if (!eligible) {
    await tx.execute(
      sql`UPDATE parties SET disbanded_at=clock_timestamp(),countdown_ends_at=NULL,version=version+1 WHERE id=${id}::uuid`,
    );
    await tx.execute(sql`DELETE FROM party_members WHERE party_id=${id}::uuid`);
  }
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
    sql`UPDATE party_members pm SET last_seen_at=GREATEST(pm.last_seen_at,COALESCE((SELECT max(l.expires_at-interval '90 seconds') FROM platform_presence_leases l WHERE l.owner_id=pm.owner_id),pm.last_seen_at)) WHERE pm.party_id=${id}::uuid`,
  );
  await tx.execute(
    sql`UPDATE party_members pm SET last_seen_at=clock_timestamp() WHERE pm.party_id=${id}::uuid AND EXISTS(SELECT 1 FROM realtime_presence_leases l WHERE l.subject=pm.owner_id AND l.expires_at>clock_timestamp())`,
  );
  const offline = await tx.execute(
    sql`UPDATE party_members pm SET ready=false WHERE pm.party_id=${id}::uuid AND pm.ready AND NOT (${online}) RETURNING owner_id`,
  );
  const removed = await tx.execute(
    sql`DELETE FROM party_members pm WHERE pm.party_id=${id}::uuid AND pm.last_seen_at<=clock_timestamp()-interval '5 minutes' AND NOT (${online}) RETURNING owner_id`,
  );
  if (removed.rows.length) await reset(tx, id);
  else if (offline.rows.length)
    await tx.execute(
      sql`UPDATE parties SET countdown_ends_at=NULL,queue_error=NULL,version=version+1 WHERE id=${id}::uuid`,
    );
  if (
    !(
      await tx.execute(
        sql`SELECT 1 FROM party_members WHERE party_id=${id}::uuid AND owner_id=${p.host}`,
      )
    ).rows.length
  )
    await transferHost(tx, id, p.settings);
  const empty = await tx.execute(
    sql`UPDATE parties p SET disbanded_at=clock_timestamp(),countdown_ends_at=NULL,version=version+1 WHERE p.id=${id}::uuid AND NOT EXISTS(SELECT 1 FROM party_members WHERE party_id=p.id) RETURNING id`,
  );
  if (
    empty.rows.length ||
    (await tx.execute(sql`SELECT 1 FROM parties WHERE id=${id}::uuid AND disbanded_at IS NOT NULL`))
      .rows.length
  )
    return;
  if (p.current) {
    const done = (
      await tx.execute(
        sql`SELECT 1 FROM matches m WHERE m.id=${p.current}::uuid AND m.state IN ('completed','cancelled') AND NOT (${reviewPending(sql`m.id`)})`,
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
      // Readers acquire identity locks first; never wait for them while holding the party.
      if (classifyDatabaseError(error) === "lock_timeout") return;
      if (!(error instanceof ApplicationError)) throw error;
      await reset(tx, id);
      const message = [
        "no_matching_questions",
        "user_busy",
        "entitlement_required",
        "invalid_input",
        "invalid_transition",
      ].includes(error.code)
        ? error.message
        : "Could not start the next round. Try again.";
      await tx.execute(sql`UPDATE parties SET queue_error=${message} WHERE id=${id}::uuid`);
    }
  }
}
export async function scheduleIfReady(tx: Transaction, id: string) {
  await tx.execute(
    sql`UPDATE parties p SET countdown_ends_at=clock_timestamp()+interval '5 seconds' WHERE p.id=${id}::uuid AND p.current_match_id IS NULL AND p.latest_match_id IS NOT NULL AND (SELECT count(*) FROM party_members WHERE party_id=p.id)>=2 AND (p.settings->>'mode'<>'showdown' OR (SELECT count(*) FROM party_members WHERE party_id=p.id)=2) AND NOT EXISTS(SELECT 1 FROM party_members pm WHERE pm.party_id=p.id AND (NOT pm.ready OR NOT (${online})))`,
  );
}
