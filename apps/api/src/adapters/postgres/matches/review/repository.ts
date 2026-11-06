/** @file repository.ts @description Authorized latest-round review projection. @module matches */
import { reviewPending } from "./pending.ts";
import { sql } from "drizzle-orm";
import type { ConnectionScope } from "@quorem/database/core";
import { ApplicationError } from "../../../../application/error.ts";
import type { MatchReview } from "../../../../modules/matches/review/model.ts";
import type { WorkspaceLanguage } from "../../../../modules/workspace/model.ts";
import { guestMayReadMatch } from "../../identity/guest.ts";
import { projectAuthorizedVersion } from "../../problems/queries/repository.ts";

type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
type Participant = {
  userId: string;
  displayName: string;
  own: boolean;
  workspace: { id: string; language: WorkspaceLanguage } | null;
  submission: {
    language: WorkspaceLanguage;
    source: string;
    verdict: string | null;
    state: string;
  } | null;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const missing = () => new ApplicationError("not_found", "Match review not found", 404);

/** Reads source only after authorizing the entire settled round and viewer's latest participation. */
export function matchReviewRepository(run: Run): MatchReview {
  return {
    async read(principal, matchId) {
      if (!uuid.test(matchId)) throw missing();
      return run((scope) =>
        scope.transaction(
          { isolation: "repeatable read", statementTimeoutMs: 5000, lockTimeoutMs: 1000 },
          async (tx) => {
            if (principal.kind === "guest" && !(await guestMayReadMatch(tx, principal, matchId)))
              throw missing();
            const match = (
              await tx.execute<{
                completedAt: string;
                shareCodeAfterMatch: boolean;
                problemId: string;
                outcome: unknown;
              }>(sql`
          SELECT to_char(m.completed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "completedAt",m.share_code_after_match AS "shareCodeAfterMatch",m.problem_version_id::text AS "problemId",m.outcome
          FROM matches m JOIN match_participants viewer ON viewer.match_id=m.id AND viewer.owner_id=${principal.userId}
          JOIN users u ON u.id=viewer.owner_id AND NOT u.disabled
          WHERE m.id=${matchId}::uuid AND m.started_at IS NOT NULL AND m.state IN ('completed','cancelled')
            AND m.completed_at>clock_timestamp()-interval '24 hours' AND m.problem_version_id IS NOT NULL
            AND NOT (${reviewPending(sql`m.id`)})
            AND NOT EXISTS (SELECT 1 FROM match_participants later JOIN matches next ON next.id=later.match_id
              WHERE later.owner_id=viewer.owner_id AND next.started_at IS NOT NULL
                AND (next.started_at,next.id)>(m.started_at,m.id))
        `)
            ).rows[0];
            if (!match) throw missing();
            const participants = (
              await tx.execute<Participant>(sql`
          SELECT u.participant_id AS "userId",u.display_name AS "displayName",p.owner_id=${principal.userId} AS own,
            CASE WHEN p.owner_id=${principal.userId} AND w.id IS NOT NULL THEN jsonb_build_object('id',w.id,'language',w.language) ELSE NULL END AS workspace,
            CASE WHEN s.id IS NOT NULL THEN jsonb_build_object('language',sw.language,'source',s.source,'verdict',s.result->>'verdict','state',s.state) ELSE NULL END AS submission
          FROM match_participants p JOIN users u ON u.id=p.owner_id
          LEFT JOIN workspaces w ON w.id=p.workspace_id AND p.owner_id=${principal.userId}
          LEFT JOIN LATERAL (SELECT id,workspace_id,source,result,state FROM submissions
            WHERE match_id=p.match_id AND owner_id=p.owner_id AND kind='submit' AND match_sequence IS NOT NULL
              AND (p.owner_id=${principal.userId} OR ${match.shareCodeAfterMatch})
            ORDER BY match_sequence DESC LIMIT 1) s ON true
          LEFT JOIN workspaces sw ON sw.id=s.workspace_id
          WHERE p.match_id=${matchId}::uuid AND (p.owner_id=${principal.userId} OR ${match.shareCodeAfterMatch}) ORDER BY p.seat
        `)
            ).rows;
            const problem = await projectAuthorizedVersion(tx, match.problemId);
            if (!problem) throw missing();
            const prefix = JSON.stringify({
              matchId,
              completedAt: match.completedAt,
              shareCodeAfterMatch: match.shareCodeAfterMatch,
              outcome: match.outcome,
              participants,
            });
            return `${prefix.slice(0, -1)},"problem":${problem}}`;
          },
        ),
      );
    },
  };
}
