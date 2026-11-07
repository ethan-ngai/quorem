/** @file document.ts @description Version-fenced team documents using the shared change codec. @module factions */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import { ApplicationError } from "../../../application/error.ts";
import { applyDocumentChanges } from "../../../application/document-changes.ts";
import type { TeamAccess } from "./access.ts";
const invalid = () => new ApplicationError("invalid_input", "Invalid document update", 400);
export async function pullTeamDocument(
  tx: Transaction,
  id: string,
  team: TeamAccess,
  body: Record<string, unknown>,
) {
  if (body.epoch !== team.epoch)
    throw new ApplicationError("document_changed", "Team document changed", 409);
  if (
    typeof body.version !== "number" ||
    !Number.isSafeInteger(body.version) ||
    body.version < 0 ||
    body.version > team.version
  )
    throw invalid();
  const updates = (
    await tx.execute<{ clientID: string; changes: unknown }>(
      sql`SELECT "clientID",changes FROM (SELECT client_id AS "clientID",changes,version,row_number() OVER (ORDER BY version) AS n,sum(octet_length(changes::text)+octet_length(client_id)*6+128) OVER (ORDER BY version) AS bytes FROM team_document_updates WHERE match_id=${id}::uuid AND team=${team.team} AND epoch=${team.epoch}::uuid AND version>${body.version}) page WHERE n<=256 AND (bytes<=245760 OR n=1) ORDER BY version`,
    )
  ).rows;
  return { epoch: team.epoch, version: body.version + updates.length, updates };
}
export async function pushTeamDocument(
  tx: Transaction,
  id: string,
  team: TeamAccess,
  body: Record<string, unknown>,
) {
  if (body.epoch !== team.epoch)
    throw new ApplicationError("document_changed", "Team document changed", 409);
  if (body.version !== team.version)
    throw new ApplicationError("stale_version", "Pull document updates and retry", 409);
  if (
    !Array.isArray(body.updates) ||
    body.updates.length < 1 ||
    body.updates.length > 32 ||
    !Number.isSafeInteger(team.version + body.updates.length)
  )
    throw invalid();
  let source = team.source,
    version = team.version;
  for (const update of body.updates) {
    if (
      !update ||
      typeof update !== "object" ||
      typeof update.clientID !== "string" ||
      !update.clientID.trim() ||
      new TextEncoder().encode(update.clientID).length > 128
    )
      throw invalid();
    source = applyDocumentChanges(source, update.changes);
    version++;
    await tx.execute(
      sql`INSERT INTO team_document_updates(match_id,team,epoch,version,client_id,changes) VALUES(${id}::uuid,${team.team},${team.epoch}::uuid,${version},${update.clientID},${JSON.stringify(update.changes)}::jsonb)`,
    );
  }
  await tx.execute(
    sql`UPDATE match_teams SET source=${source},document_version=${version} WHERE match_id=${id}::uuid AND team=${team.team}`,
  );
  return { epoch: team.epoch, version, updates: body.updates };
}
