/** @file repository.ts @description Player-owned counts, calendar and resume targets from one PostgreSQL snapshot. */
import { sql } from "drizzle-orm";
import type { ConnectionScope } from "@quorem/database/core";
import { ApplicationError } from "../../../application/error.ts";
import type { PlayerDashboard } from "@quorem/contracts";
import { restrictedTopicPublications, topicProjection } from "../problems/topics.ts";

type Run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => Promise<T>;

export function playerDashboard(run: Run) {
  return (owner: string, timeZone: string) =>
    run((scope) =>
      scope.transaction(
        { readOnly: true, statementTimeoutMs: 3000, lockTimeoutMs: 1000 },
        async (tx) => {
          const { rows } = await tx.execute<{ dashboard: PlayerDashboard }>(sql`
          WITH account AS (
            SELECT id, participant_id FROM users WHERE id=${owner} AND kind='account' AND NOT disabled
          ), restricted AS (
            ${restrictedTopicPublications(owner)}
          ), clock AS (
            SELECT (transaction_timestamp() AT TIME ZONE ${timeZone})::date AS today
          ), progress AS (
            SELECT p.id AS problem_id, p.slug, v.title, v.difficulty, v.id AS publication_id,
              p.current_publication_id = v.id AS current,
              v.odyssey IS NOT NULL AS odyssey, w.updated_at,
              CASE WHEN v.odyssey IS NOT NULL THEN COALESCE(o.completed, false)
                ELSE s.workspace_id IS NOT NULL OR t.workspace_id IS NOT NULL END AS solved,
              o.level AS stage, jsonb_array_length(v.odyssey->'levels') AS stages
            FROM account a JOIN workspaces w ON w.owner_id=a.id AND w.kind='solo'
            JOIN question_publications v ON v.id=w.publication_id
            JOIN problems p ON p.id=v.problem_id AND (p.owner_id IS NULL OR p.owner_id=a.id)
            LEFT JOIN practice_solves s ON s.workspace_id=w.id
            LEFT JOIN practice_target_progress t ON t.workspace_id=w.id
            LEFT JOIN odyssey_progress o ON o.scope_id=w.id AND o.publication_id=v.id
            UNION ALL
            SELECT p.id, p.slug, v.title, v.difficulty, v.id,
              p.current_publication_id=v.id, false, ms.solved_at, true, NULL, NULL
            FROM account a JOIN match_question_solves ms ON ms.owner_id=a.id
            JOIN question_publications v ON v.id=ms.publication_id
            JOIN problems p ON p.id=v.problem_id AND (p.owner_id IS NULL OR p.owner_id=a.id)
          ), solved AS (
            SELECT DISTINCT ON (problem_id) * FROM progress WHERE solved
            ORDER BY problem_id, updated_at DESC, publication_id
          ), resume AS (
            SELECT DISTINCT ON (odyssey) q.* FROM progress q
            WHERE q.current AND NOT q.solved
              AND NOT EXISTS (SELECT 1 FROM progress done WHERE done.publication_id=q.publication_id AND done.solved)
            ORDER BY odyssey, updated_at DESC, publication_id
          ), practice AS (
            SELECT e.submission_id::text AS id, e.observed_at AS at,
              (e.observed_at AT TIME ZONE ${timeZone})::date AS day, v.title, v.difficulty,
              v.odyssey IS NOT NULL AS odyssey
            FROM account a JOIN question_learning_events e ON e.owner_id=a.id
            JOIN question_publications v ON v.id=e.publication_id
            JOIN problems p ON p.id=v.problem_id AND (p.owner_id IS NULL OR p.owner_id=a.id)
            WHERE e.context='practice' AND e.accepted AND e.observed_at<=transaction_timestamp()
            UNION ALL
            -- Learning events record final Odyssey stages. The submission store covers earlier stages while retained.
            SELECT s.id::text, s.updated_at, (s.updated_at AT TIME ZONE ${timeZone})::date,
              v.title, v.difficulty, true
            FROM account a JOIN submissions s ON s.owner_id=a.id
            JOIN workspaces w ON w.id=s.workspace_id AND w.owner_id=a.id AND w.kind='solo'
            JOIN question_publications v ON v.id=w.publication_id
            JOIN problems p ON p.id=v.problem_id AND (p.owner_id IS NULL OR p.owner_id=a.id)
            WHERE s.kind='submit' AND s.state='completed' AND s.result->>'verdict'='accepted'
              AND s.match_id IS NULL AND s.interview_id IS NULL AND NOT s.custom_run
              AND s.odyssey_level < jsonb_array_length(v.odyssey->'levels')
              AND s.updated_at<=transaction_timestamp()
          ), matches_played AS (
            SELECT m.id::text, m.completed_at AS at, m.mode, m.publication_id, mp.team, mp.owner_id,
              (m.completed_at AT TIME ZONE ${timeZone})::date AS day,
              CASE m.mode WHEN 'factions' THEN 'Factions' WHEN 'free-for-all' THEN 'Free-for-all'
                ELSE 'Showdown' END AS title,
              CASE WHEN m.outcome->>'kind'='draw' THEN 'draw'
                WHEN NOT mp.forfeited AND (m.outcome->>'winnerUserId'=a.participant_id::text
                  OR m.outcome->>'winnerTeam'=mp.team::text) THEN 'victory' ELSE 'loss' END AS outcome
            FROM account a JOIN match_participants mp ON mp.owner_id=a.id
            JOIN matches m ON m.id=mp.match_id
            WHERE m.state='completed' AND m.started_at IS NOT NULL
              AND m.completed_at<=transaction_timestamp() AND m.outcome->>'kind' IN ('win','draw')
          ), daily AS (
            SELECT day, sum(practice)::int AS practice, sum(matches)::int AS matches
            FROM (
              SELECT day, count(*) AS practice, 0::bigint AS matches FROM practice GROUP BY day
              UNION ALL
              SELECT day, 0::bigint, count(*) FROM matches_played GROUP BY day
            ) events GROUP BY day
          ), streak AS (
            SELECT day, day + (row_number() OVER (ORDER BY day DESC))::int AS anchor FROM daily
          ), recent AS (
            SELECT id, at, day, title, CASE WHEN odyssey THEN 'odyssey' ELSE 'practiceAccepted' END AS kind,
              difficulty, NULL::text AS outcome, NULL::jsonb AS opponents, NULL::text AS mode FROM practice
            UNION ALL
            SELECT m.id, m.at, m.day, COALESCE(v.title, m.title), 'matchPlayed', NULL::text, m.outcome,
              COALESCE((SELECT jsonb_agg(u.display_name ORDER BY opponent.seat)
                FROM match_participants opponent JOIN users u ON u.id=opponent.owner_id
                WHERE opponent.match_id=m.id::uuid AND opponent.owner_id<>m.owner_id
                  AND (m.mode<>'factions' OR opponent.team IS DISTINCT FROM m.team)), '[]'::jsonb), m.mode
            FROM (SELECT * FROM matches_played ORDER BY at DESC,id LIMIT 5) m
            LEFT JOIN question_publications v ON v.id=m.publication_id
          )
          SELECT jsonb_build_object(
            'streakDays', (SELECT count(*)::int FROM streak WHERE anchor=
              CASE WHEN EXISTS(SELECT 1 FROM daily WHERE day=c.today) THEN c.today+1 ELSE c.today END),
            'activity', COALESCE((SELECT jsonb_agg(jsonb_build_object('day',day-c.today,
              'practice',practice,'matches',matches) ORDER BY day) FROM daily WHERE day BETWEEN c.today-179 AND c.today),'[]'),
            'solved', (SELECT jsonb_build_object('easy',count(*) FILTER (WHERE difficulty='easy'),
              'medium',count(*) FILTER (WHERE difficulty='medium'),'hard',count(*) FILTER (WHERE difficulty='hard'))
              FROM solved WHERE NOT odyssey),
            'odysseysCompleted', (SELECT count(*) FROM solved WHERE odyssey),
            'topics', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY count DESC, topic) FROM (
              SELECT tag AS topic,count(*) AS count FROM solved s
              CROSS JOIN LATERAL jsonb_array_elements_text(${topicProjection(sql`s.publication_id`)}) AS tags(tag)
              WHERE NOT s.odyssey AND NOT EXISTS (SELECT 1 FROM restricted WHERE id=s.publication_id::text) GROUP BY tag ORDER BY count DESC, topic LIMIT 3
            ) t),'[]'),
            'matches', (SELECT jsonb_build_object('victory', count(*) FILTER (WHERE outcome='victory'),
              'draw',count(*) FILTER (WHERE outcome='draw'),'loss',count(*) FILTER (WHERE outcome='loss'))
              FROM matches_played WHERE day>=c.today-29),
            'recent', COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
              'id',id,'day',day-c.today,'title',title,'kind',kind,'difficulty',difficulty,'outcome',outcome,'opponents',opponents,'mode',mode
            )) ORDER BY at DESC,id) FROM (SELECT * FROM recent ORDER BY at DESC,id LIMIT 5) r),'[]'),
            'practice', (SELECT jsonb_build_object('slug',slug,'title',title,'difficulty',difficulty,
              'tags',CASE WHEN EXISTS (SELECT 1 FROM restricted WHERE id=r.publication_id::text) THEN '[]'::jsonb ELSE ${topicProjection(sql`r.publication_id`)} END) FROM resume r WHERE NOT odyssey),
            'odyssey', (SELECT jsonb_build_object('slug',slug,'title',title,'difficulty',difficulty,
              'stage',COALESCE(stage,1),'stages',stages) FROM resume WHERE odyssey)
          ) AS dashboard FROM account CROSS JOIN clock c
        `);
          if (!rows[0]) throw new ApplicationError("forbidden", "Account required", 403);
          return rows[0].dashboard;
        },
      ),
    );
}
