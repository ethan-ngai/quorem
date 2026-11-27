/** @file company-evidence.ts @description Current company snapshot and catalog membership. @module problems */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";

const latestSnapshot = sql`
  SELECT revision, source_url, snapshot_date FROM company_question_snapshots
  ORDER BY snapshot_date DESC, revision DESC LIMIT 1
`;

/** Evidence can surface global questions independently of their authored tags. */
export const catalogCompanyMembership = sql`(
  SELECT problem_id, company_id FROM problem_companies
  UNION
  SELECT p.id, o.company_id FROM (${latestSnapshot}) snapshot
  JOIN company_question_observations o ON o.snapshot_revision=snapshot.revision
  JOIN problems p ON p.leetcode_id=o.leetcode_id AND p.owner_id IS NULL
)`;

/** Read provenance once per page, including when its questions have only authored tags. */
export async function readCompanySnapshot(tx: Transaction, company: string) {
  const { rows } = await tx.execute<{
    company: string;
    companyId: string;
    revision: string;
    snapshotDate: string;
    sourceUrl: string;
  }>(sql`
    SELECT c.name AS company, c.id::text AS "companyId", s.revision,
      s.snapshot_date::text AS "snapshotDate", s.source_url AS "sourceUrl"
    FROM (${latestSnapshot}) s JOIN companies c ON c.name=${company}
    WHERE EXISTS (
      SELECT 1 FROM company_question_observations o
      WHERE o.snapshot_revision=s.revision AND o.company_id=c.id
    )
  `);
  return rows[0];
}

/** Select the shortest observed source window for each public problem. */
export function joinCompanyEvidence(snapshot: Awaited<ReturnType<typeof readCompanySnapshot>>) {
  return sql`LEFT JOIN LATERAL (
    SELECT window_rank, frequency FROM company_question_observations o
    WHERE p.owner_id IS NULL AND o.snapshot_revision=${snapshot.revision}
      AND o.company_id=${snapshot.companyId}::bigint AND o.leetcode_id=p.leetcode_id
    ORDER BY window_rank LIMIT 1
  ) evidence ON true`;
}
