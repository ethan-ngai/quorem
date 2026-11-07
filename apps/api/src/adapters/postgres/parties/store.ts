/** @file store.ts @description Party authorization and snapshots. @module parties */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import { ApplicationError } from "../../../application/error.ts";
import type { Principal } from "../../../modules/identity/model.ts";
import type { PartySettings } from "../../../modules/parties/model.ts";
import { guestMayAccessParty } from "../identity/guest.ts";
import { capabilitiesInTransaction } from "../access/repository.ts";
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const missing = () => new ApplicationError("not_found", "Party not found", 404);
export const conflict = (message: string) =>
  new ApplicationError("invalid_transition", message, 409);
export const online = sql`EXISTS (SELECT 1 FROM platform_presence_leases l WHERE l.owner_id=pm.owner_id AND l.expires_at>clock_timestamp()) OR EXISTS (SELECT 1 FROM realtime_presence_leases l WHERE l.subject=pm.owner_id AND l.expires_at>clock_timestamp())`;
export async function validateGuest(tx: Transaction, who: Principal) {
  if (who.kind === "guest") {
    if (who.scope.kind !== "party" || !(await guestMayAccessParty(tx, who, who.scope.partyId)))
      throw missing();
    const party = (
      await tx.execute<{ host: string }>(
        sql`SELECT host_owner_id AS host FROM parties WHERE id=${who.scope.partyId}::uuid AND disbanded_at IS NULL FOR UPDATE`,
      )
    ).rows[0];
    if (!party || !(await capabilitiesInTransaction(tx, party.host)).hostGuests) throw missing();
  }
}
export async function lockParty(tx: Transaction, id: string, owner: string) {
  if (!uuid.test(id)) throw missing();
  const row = (
    await tx.execute<{
      host: string;
      settings: PartySettings;
      current: string | null;
    }>(
      sql`SELECT p.host_owner_id AS host,p.settings,p.current_match_id::text AS current FROM parties p JOIN party_members pm ON pm.party_id=p.id AND pm.owner_id=${owner} WHERE p.id=${id}::uuid AND p.disbanded_at IS NULL FOR UPDATE OF p`,
    )
  ).rows[0];
  if (!row) throw missing();
  return row;
}
export async function snapshot(tx: Transaction, id: string) {
  const previousWinner = sql`CASE WHEN previous.outcome->>'kind' = 'win' AND (
    CASE WHEN previous.mode = 'factions' THEN EXISTS (
      SELECT 1 FROM match_participants mp WHERE mp.match_id = previous.id
        AND mp.owner_id = pm.owner_id AND mp.team::text = previous.outcome->>'winnerTeam'
    ) ELSE u.participant_id::text = previous.outcome->>'winnerUserId' END
  ) THEN true END`;
  const row = (
    await tx.execute<{ data: unknown }>(
      sql`SELECT jsonb_build_object('id',p.id,'version',p.version::text,'hostUserId',h.participant_id,'settings',p.settings,'currentMatchId',p.current_match_id,'latestMatchId',p.latest_match_id,'countdownEndsAt',p.countdown_ends_at,'queueError',p.queue_error,'members',COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('userId',u.participant_id,'displayName',u.display_name,'color',NULLIF(u.profile_color,0),'image',NULLIF(u.profile_image,''),'ready',pm.ready,'online',(${online}),'joinedAt',pm.joined_at,'previousWinner',${previousWinner})) ORDER BY pm.seat) FROM party_members pm JOIN users u ON u.id=pm.owner_id WHERE pm.party_id=p.id),'[]'::jsonb)) AS data FROM parties p JOIN users h ON h.id=p.host_owner_id LEFT JOIN matches previous ON previous.id=p.latest_match_id WHERE p.id=${id}::uuid`,
    )
  ).rows[0];
  if (!row) throw missing();
  return row.data;
}
export async function reset(tx: Transaction, id: string) {
  await tx.execute(sql`UPDATE party_members SET ready=false WHERE party_id=${id}::uuid`);
  await tx.execute(
    sql`UPDATE parties SET countdown_ends_at=NULL,queue_error=NULL,version=version+1 WHERE id=${id}::uuid`,
  );
}
