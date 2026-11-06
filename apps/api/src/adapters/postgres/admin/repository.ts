/** @file repository.ts @description Bounded administrator aggregates from authoritative PostgreSQL. @module admin */
import { sql } from "drizzle-orm";
import type { ConnectionScope } from "@quorem/database/core";
import { ApplicationError } from "../../../application/error.ts";
import type { AdminOverview, AdminOverviewReader } from "../../../modules/admin/model.ts";

type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;

/** @returns Consistent aggregates with bounded detail rows and database execution time. */
export function adminOverview(run: Run): AdminOverviewReader {
  return {
    overview(userId) {
      return run((scope) =>
        scope.transaction(
          {
            readOnly: true,
            isolation: "repeatable read",
            statementTimeoutMs: 4000,
            lockTimeoutMs: 1000,
          },
          async (tx) => {
            const authority = await tx.execute(
              sql`SELECT 1 FROM users WHERE id=${userId} AND kind='account' AND role='admin' AND NOT disabled`,
            );
            if (!authority.rows.length)
              throw new ApplicationError("forbidden", "Administrator access required", 403);
            const result = await tx.execute<{ overview: AdminOverview }>(sql`
            WITH bounds AS (SELECT transaction_timestamp() AS at, transaction_timestamp() - interval '7 days' AS start),
            activity AS (
              SELECT s.owner_id, count(*)::integer AS submissions, max(s.admitted_at) AS last_at
              FROM submissions s, bounds w
              WHERE s.kind='submit' AND s.admitted_at >= w.start GROUP BY s.owner_id
            ),
            active_accounts AS (
              SELECT u.id, u.display_name, u.role, u.disabled, a.submissions, a.last_at
              FROM activity a JOIN users u ON u.id=a.owner_id WHERE u.kind='account'
            )
            SELECT json_build_object(
              'generatedAt', w.at, 'windowStart', w.start,
              'users', (SELECT json_build_object(
                'accounts', count(*)::integer,
                'administrators', count(*) FILTER (WHERE role='admin' AND NOT disabled)::integer,
                'disabled', count(*) FILTER (WHERE disabled)::integer,
                'active7d', (SELECT count(*)::integer FROM active_accounts)
              ) FROM users WHERE kind='account'),
              'content', json_build_object(
                'publications', (SELECT count(*)::integer FROM problems WHERE owner_id IS NULL AND current_version_id IS NOT NULL),
                'drafts', (SELECT count(*)::integer FROM question_drafts WHERE owner_id IS NULL AND published_version_id IS NULL),
                'workspaces', (SELECT count(*)::integer FROM workspaces)
              ),
              'submissions', json_build_object(
                'retained7d', (SELECT coalesce(sum(submissions),0)::integer FROM activity),
                'pending', (SELECT count(*)::integer FROM submissions WHERE state IN ('queued','running'))
              ),
              'activeUsers', coalesce((SELECT json_agg(json_build_object(
                'id', a.id, 'displayName', a.display_name, 'role', a.role, 'disabled', a.disabled,
                'submissions', a.submissions, 'lastSubmittedAt', a.last_at
              ) ORDER BY a.last_at DESC, a.id) FROM (
                SELECT * FROM active_accounts ORDER BY last_at DESC, id LIMIT 8
              ) a), '[]'::json),
              'recentDrafts', coalesce((SELECT json_agg(json_build_object(
                'id', d.id, 'title', coalesce(d.content->'problem'->>'title','Untitled question'),
                'updatedAt', d.updated_at, 'editingPublication', d.edit_version_id IS NOT NULL
              ) ORDER BY d.updated_at DESC, d.id) FROM (
                SELECT id, content, updated_at, edit_version_id FROM question_drafts
                WHERE owner_id IS NULL AND published_version_id IS NULL ORDER BY updated_at DESC, id LIMIT 5
              ) d), '[]'::json)
            ) AS overview FROM bounds w
          `);
            return result.rows[0].overview;
          },
        ),
      );
    },
  };
}
