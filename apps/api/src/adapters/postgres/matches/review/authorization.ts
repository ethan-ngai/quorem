/** @file authorization.ts @description Bounded completed-match review access. @module matches */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import { ApplicationError } from "../../../../application/error.ts";
import type { Principal } from "../../../../modules/identity/model.ts";
import { guestMayReadMatch } from "../../identity/guest.ts";
import { reviewPending } from "./pending.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const missing = () => new ApplicationError("not_found", "Match review not found", 404);

/** Authorizes the viewer and, when supplied, the source participant. */
export async function authorizeReview(
  tx: Transaction,
  principal: Principal,
  matchId: string,
  sourceOwner?: string,
  settled = true,
) {
  if (!uuid.test(matchId)) throw missing();
  const locked = await tx.execute(
    sql`SELECT id FROM users WHERE id=${principal.userId} AND NOT disabled FOR NO KEY UPDATE`,
  );
  if (!locked.rows.length) throw missing();
  if (principal.kind === "guest" && !(await guestMayReadMatch(tx, principal, matchId)))
    throw missing();
  const row = (
    await tx.execute<{
      completedAt: string;
      shareCodeAfterMatch: boolean;
      problemId: string;
      outcome: unknown;
      host: string;
      hostEnabled: boolean;
    }>(sql`
    SELECT to_char(m.completed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "completedAt",m.share_code_after_match AS "shareCodeAfterMatch",m.problem_version_id::text AS "problemId",m.outcome,m.host_owner_id AS host,NOT host.disabled AS "hostEnabled"
    FROM matches m JOIN match_participants viewer ON viewer.match_id=m.id AND viewer.owner_id=${principal.userId}
    JOIN users u ON u.id=viewer.owner_id AND NOT u.disabled JOIN users host ON host.id=m.host_owner_id
    WHERE m.id=${matchId}::uuid AND m.started_at IS NOT NULL AND m.state IN ('completed','cancelled')
      AND m.completed_at>clock_timestamp()-interval '24 hours' AND m.problem_version_id IS NOT NULL
      AND (${!settled} OR NOT (${reviewPending(sql`m.id`)}))
      AND NOT EXISTS (SELECT 1 FROM match_participants later JOIN matches next ON next.id=later.match_id
        WHERE later.owner_id=viewer.owner_id AND next.started_at IS NOT NULL AND (next.started_at,next.id)>(m.started_at,m.id))
      AND (${sourceOwner ?? null}::text IS NULL OR EXISTS (SELECT 1 FROM match_participants source WHERE source.match_id=m.id AND source.owner_id=${sourceOwner ?? null} AND (source.owner_id=viewer.owner_id OR m.share_code_after_match)))
  `)
  ).rows[0];
  if (!row) throw missing();
  return row;
}

/** Allows a forfeited viewer to keep their own frozen workspace while the round continues. */
export async function authorizeFrozenOwnWorkspace(
  tx: Transaction,
  principal: Principal,
  matchId: string,
  versionId: string,
) {
  if (!uuid.test(matchId)) throw missing();
  const locked = await tx.execute(
    sql`SELECT id FROM users WHERE id=${principal.userId} AND NOT disabled FOR NO KEY UPDATE`,
  );
  if (!locked.rows.length) throw missing();
  if (principal.kind === "guest" && !(await guestMayReadMatch(tx, principal, matchId)))
    throw missing();
  const row = await tx.execute(sql`
    SELECT 1 FROM matches m JOIN match_participants p ON p.match_id=m.id AND p.owner_id=${principal.userId} AND p.forfeited
    JOIN users u ON u.id=p.owner_id AND NOT u.disabled JOIN users host ON host.id=m.host_owner_id AND NOT host.disabled
    WHERE m.id=${matchId}::uuid AND m.problem_version_id=${versionId}::uuid AND m.state IN ('active','finalizing')
      AND NOT EXISTS (SELECT 1 FROM match_participants later JOIN matches next ON next.id=later.match_id
        WHERE later.owner_id=p.owner_id AND next.started_at IS NOT NULL AND (next.started_at,next.id)>(m.started_at,m.id))
  `);
  if (!row.rows.length) {
    const review = await authorizeReview(tx, principal, matchId, principal.userId, false);
    if (review.problemId !== versionId) throw missing();
  }
}
