/** @file measurement.ts @description Aggregate practice experiment and match selection outcomes. @module problems */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";

export async function recommendationMeasurement(tx: Transaction) {
  const practice = await tx.execute(sql`
    SELECT r.variant, r.model_id, count(DISTINCT r.owner_id)::int AS learners,
      count(*)::int AS impressions,count(r.started_at)::int AS starts,
      count(r.dismissed_at)::int AS dismissals,count(r.first_outcome_at)::int AS attempts,
      count(*) FILTER(WHERE r.started_at<statement_timestamp()-interval '2 hours' AND r.first_outcome_at IS NULL)::int AS mature_starts_without_judged_attempt,
      count(r.solved_at)::int AS solves,
      count(DISTINCT r.owner_id) FILTER(WHERE r.solved_at IS NOT NULL)::int AS learners_with_solve,
      count(*) FILTER(WHERE r.solved_at<statement_timestamp()-interval '14 days')::int AS mature_solves,
      count(*) FILTER(WHERE r.solved_at<statement_timestamp()-interval '14 days' AND r.followup_solved IS NOT NULL)::int AS delayed_attempts,
      count(*) FILTER(WHERE r.solved_at<statement_timestamp()-interval '14 days' AND r.followup_solved)::int AS delayed_solves,
      count(DISTINCT r.owner_id) FILTER(WHERE r.solved_at<statement_timestamp()-interval '14 days' AND r.followup_solved)::int AS learners_with_delayed_solve,
      count(transfer.accepted)::int AS transfer_attempts,
      count(*) FILTER(WHERE transfer.accepted)::int AS transfer_solves
    FROM recommendation_impressions r JOIN problem_versions v ON v.id=r.version_id
    JOIN problems p ON p.id=v.problem_id
    LEFT JOIN LATERAL (
      SELECT e.accepted
      FROM question_learning_events e
      JOIN problem_versions next ON next.id=e.version_id
      JOIN problems next_problem ON next_problem.id=next.problem_id
      WHERE r.solved_at<statement_timestamp()-interval '14 days'
        AND e.owner_id=r.owner_id AND e.version_id<>r.version_id
        AND e.context='practice' AND NOT e.assisted AND next_problem.owner_id IS NULL
        AND e.observed_at>=r.solved_at+interval '2 days'
        AND e.attempted_at BETWEEN r.solved_at+interval '2 days' AND r.solved_at+interval '14 days'
        AND e.tags && ARRAY(SELECT tag FROM problem_tags WHERE version_id=r.version_id)
        AND NOT EXISTS (
          SELECT 1 FROM question_learning_events earlier
          WHERE earlier.owner_id=e.owner_id AND earlier.version_id=e.version_id
            AND (earlier.attempted_at,earlier.submission_id)<(e.attempted_at,e.submission_id)
        )
      ORDER BY e.attempted_at,e.submission_id LIMIT 1
    ) transfer ON true
    WHERE p.owner_id IS NULL AND r.viewed_at IS NOT NULL
    GROUP BY r.variant,r.model_id ORDER BY r.variant,r.model_id
  `);
  const matches = await tx.execute(sql`
    SELECT r.model_id,count(*)::int AS selections,avg(r.mean_success) AS mean_success,
      avg(r.success_spread) AS mean_success_spread,avg(r.familiarity_gap) AS mean_familiarity_gap,
      count(*) FILTER(WHERE m.state='completed')::int AS completed,
      avg(seats.score_spread) FILTER(WHERE m.state='completed') AS mean_final_score_spread,
      count(*) FILTER(WHERE m.outcome->>'reason'='first_correct')::int AS won_by_solving
    FROM recommendation_match_selections r JOIN matches m ON m.id=r.match_id
    JOIN problem_versions v ON v.id=m.problem_version_id JOIN problems p ON p.id=v.problem_id
    CROSS JOIN LATERAL (SELECT max(best_percentage)-min(best_percentage) AS score_spread
      FROM match_participants WHERE match_id=m.id AND NOT forfeited) seats
    WHERE p.owner_id IS NULL GROUP BY r.model_id ORDER BY r.model_id
  `);
  return { practice: practice.rows, matches: matches.rows };
}
