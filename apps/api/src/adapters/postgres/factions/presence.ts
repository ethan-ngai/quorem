/** @file presence.ts @description Bounded team-private advisory cursor leases. @module factions */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import type { TeamPeer } from "@quorem/contracts/factions";
import type { TeamAccess } from "./access.ts";
import { ApplicationError } from "../../../application/error.ts";
export async function teamPeers(
  tx: Transaction,
  id: string,
  team: TeamAccess,
): Promise<TeamPeer[]> {
  const rows = await tx.execute<{ peer: TeamPeer }>(
    sql`SELECT p.payload || jsonb_build_object('userId',u.participant_id,'name',u.display_name,'color',u.profile_color) AS peer FROM team_document_presence p JOIN users u ON u.id=p.owner_id WHERE p.match_id=${id}::uuid AND p.team=${team.team} AND p.expires_at>clock_timestamp() AND p.payload->>'epoch'=${team.epoch} ORDER BY p.owner_id,p.client_id`,
  );
  return rows.rows.map((r) => r.peer);
}
export async function publishTeamPresence(
  tx: Transaction,
  id: string,
  owner: string,
  team: TeamAccess,
  body: Record<string, unknown>,
) {
  if (
    typeof body.clientID !== "string" ||
    !body.clientID ||
    body.clientID.length > 128 ||
    body.epoch !== team.epoch ||
    !Number.isSafeInteger(body.version) ||
    Number(body.version) < 0 ||
    Number(body.version) > team.version ||
    !Number.isSafeInteger(body.anchor) ||
    !Number.isSafeInteger(body.head) ||
    Number(body.anchor) < 0 ||
    Number(body.head) < 0 ||
    Number(body.anchor) > 512 * 1024 ||
    Number(body.head) > 512 * 1024
  )
    throw new ApplicationError("invalid_input", "Invalid cursor", 400);
  await tx.execute(
    sql`DELETE FROM team_document_presence WHERE match_id=${id}::uuid AND team=${team.team} AND expires_at<=clock_timestamp()`,
  );
  const count = (
    await tx.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM team_document_presence WHERE match_id=${id}::uuid AND team=${team.team} AND owner_id=${owner} AND client_id<>${body.clientID}`,
    )
  ).rows[0].n;
  if (count >= 16) throw new ApplicationError("rate_limited", "Too many editor windows", 429);
  const payload = {
    clientID: body.clientID,
    epoch: body.epoch,
    version: body.version,
    anchor: body.anchor,
    head: body.head,
  };
  await tx.execute(
    sql`INSERT INTO team_document_presence(match_id,team,owner_id,client_id,payload,expires_at) VALUES(${id}::uuid,${team.team},${owner},${body.clientID},${JSON.stringify(payload)}::jsonb,clock_timestamp()+interval '30 seconds') ON CONFLICT(match_id,team,owner_id,client_id) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at`,
  );
  return teamPeers(tx, id, team);
}
