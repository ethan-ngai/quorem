/** @file repository.ts @description Authorized latest-round review projection. @module matches */
import { authorizeReview } from "./authorization.ts";
import { sql } from "drizzle-orm";
import type { ConnectionScope } from "@quorem/database/core";
import { ApplicationError } from "../../../../application/error.ts";
import type { MatchReview } from "../../../../modules/matches/review/model.ts";
import type { WorkspaceLanguage } from "../../../../modules/workspace/model.ts";
import { questionRuntime } from "../../problems/runtime.ts";
import { projectAuthorizedVersion } from "../../problems/queries/repository.ts";

type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
type Participant = {
  userId: string;
  displayName: string;
  image: string | null;
  color: number;
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
    async createWorkspace(principal, matchId, participantUserId, language) {
      if (!uuid.test(matchId) || !uuid.test(participantUserId)) throw missing();
      return run((scope) =>
        scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
          await authorizeReview(tx, principal, matchId);
          const source = (
            await tx.execute<{ owner: string }>(
              sql`SELECT p.owner_id AS owner FROM match_participants p JOIN users u ON u.id=p.owner_id WHERE p.match_id=${matchId}::uuid AND u.participant_id=${participantUserId}::uuid`,
            )
          ).rows[0];
          if (!source) throw missing();
          const match = await authorizeReview(tx, principal, matchId, source.owner);
          const version = (
            await tx.execute<{ isSql: boolean }>(
              sql`SELECT sql_config IS NOT NULL AND sql_config <> 'null'::jsonb AS "isSql" FROM problem_versions WHERE id=${match.problemId}::uuid`,
            )
          ).rows[0];
          if (!version) throw missing();
          questionRuntime(language, version.isSql);
          return (
            await tx.execute<{
              id: string;
              kind: "review";
              problemVersionId: string;
              language: WorkspaceLanguage;
              reviewMatchId: string;
            }>(sql`
          INSERT INTO workspaces(id,owner_id,problem_version_id,language,kind,review_match_id,review_source_owner_id)
          VALUES(${crypto.randomUUID()}::uuid,${principal.userId},${match.problemId}::uuid,${language},'review',${matchId}::uuid,${source.owner})
          ON CONFLICT(review_match_id,owner_id,review_source_owner_id,language) WHERE kind='review' DO UPDATE SET owner_id=EXCLUDED.owner_id
          RETURNING id::text,kind,problem_version_id::text AS "problemVersionId",language,review_match_id::text AS "reviewMatchId"
        `)
          ).rows[0];
        }),
      );
    },
    async read(principal, matchId) {
      if (!uuid.test(matchId)) throw missing();
      return run((scope) =>
        scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 1000 }, async (tx) => {
          const match = await authorizeReview(tx, principal, matchId);
          const participants = (
            await tx.execute<Participant>(sql`
          SELECT u.participant_id AS "userId",u.display_name AS "displayName",NULLIF(u.profile_image,'') AS image,u.profile_color AS color,p.owner_id=${principal.userId} AS own,
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
            participants: participants.map(({ image, color, ...person }) => ({ ...person, image: image ?? undefined, color: color || undefined })),
          });
          return `${prefix.slice(0, -1)},"problem":${problem}}`;
        }),
      );
    },
  };
}
