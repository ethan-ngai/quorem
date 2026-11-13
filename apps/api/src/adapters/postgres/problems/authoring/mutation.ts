/** @file mutation.ts @description Fences mutations of existing publications. @module problems */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import { matchEvent } from "../../matches/reconcile/repository.ts";
import { ApplicationError } from "../../../../application/error.ts";

/** Lock the catalog parent before checking admissions that take a shared parent lock. */
export async function lockPublication(tx: Transaction, publicationId: string) {
  const [row] = (
    await tx.execute<{
      id: string;
      slug: string;
      current: string | null;
      token: string;
      owner: string | null;
    }>(sql`
    SELECT p.id::text,p.slug,p.current_publication_id::text AS current,v.xmin::text AS token,p.owner_id AS owner
    FROM question_publications v JOIN problems p ON p.id=v.problem_id
    WHERE v.id=${publicationId}::uuid FOR UPDATE OF p,v
  `)
  ).rows;
  if (!row) throw new ApplicationError("not_found", "Published question not found", 404);
  return row;
}

export async function assertPublicationIdle(tx: Transaction, publicationId: string) {
  const [row] = (
    await tx.execute<{ busy: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM workspaces w JOIN submissions s ON s.workspace_id=w.id
      LEFT JOIN execution_jobs j ON j.submission_id=s.id
      WHERE w.publication_id=${publicationId}::uuid
        AND (s.state IN ('queued','running') OR NOT j.finished OR j.lease_until IS NOT NULL)
    ) OR EXISTS (
      SELECT 1 FROM matches WHERE publication_id=${publicationId}::uuid AND state IN ('active','finalizing')
    ) AS busy
  `)
  ).rows;
  if (row.busy)
    throw new ApplicationError(
      "revision_conflict",
      "Wait for active judging and matches to finish",
      409,
    );
}

export async function removePublicationRow(tx: Transaction, publicationId: string) {
  await tx.execute(sql`SELECT set_config('quorem.question_mutation',${publicationId},true)`);
  await tx.execute(sql`DELETE FROM question_publications WHERE id=${publicationId}::uuid`);
}

export async function publicationImpact(tx: Transaction, publicationId: string) {
  return (
    await tx.execute<{
      workspaces: number;
      matches: number;
      submissions: number;
    }>(sql`
    SELECT
      (SELECT count(*)::int FROM workspaces WHERE publication_id=${publicationId}::uuid) AS workspaces,
      (SELECT count(*)::int FROM matches WHERE publication_id=${publicationId}::uuid OR selected_publication_id=${publicationId}::uuid) AS matches,
      (SELECT count(*)::int FROM submissions s JOIN workspaces w ON w.id=s.workspace_id
        WHERE w.publication_id=${publicationId}::uuid AND s.match_id IS NULL) AS submissions
  `)
  ).rows[0];
}

export async function detachPublication(tx: Transaction, publicationId: string) {
  await tx.execute(sql`SELECT set_config('quorem.question_mutation',${publicationId},true)`);
  await tx.execute(sql`
    DELETE FROM execution_jobs j
    WHERE j.finished AND j.lease_until IS NULL AND (
      EXISTS (SELECT 1 FROM runner_job_inputs i WHERE i.job_id=j.id AND i.publication_id=${publicationId}::uuid)
      OR EXISTS (SELECT 1 FROM submissions s JOIN workspaces w ON w.id=s.workspace_id
        WHERE s.id=j.submission_id AND w.publication_id=${publicationId}::uuid)
    )
  `);
  const matches = await tx.execute<{ id: string }>(sql`
    UPDATE matches SET
      selected_publication_id=NULLIF(selected_publication_id,${publicationId}::uuid),
      publication_id=NULLIF(publication_id,${publicationId}::uuid)
    WHERE selected_publication_id=${publicationId}::uuid OR publication_id=${publicationId}::uuid
    RETURNING id::text
  `);
  for (const match of matches.rows) await matchEvent(tx, match.id, "match.updated");
  await tx.execute(sql`UPDATE submissions s SET source='',result=NULL,cases='[]'::jsonb,lossless_cases=NULL
    FROM workspaces w WHERE w.id=s.workspace_id AND w.publication_id=${publicationId}::uuid AND s.match_id IS NULL`);
  await tx.execute(
    sql`DELETE FROM practice_case_feedback f USING workspaces w WHERE w.id=f.workspace_id AND w.publication_id=${publicationId}::uuid`,
  );
  await tx.execute(
    sql`DELETE FROM practice_target_progress f USING workspaces w WHERE w.id=f.workspace_id AND w.publication_id=${publicationId}::uuid`,
  );
  await tx.execute(
    sql`DELETE FROM practice_solves f USING workspaces w WHERE w.id=f.workspace_id AND w.publication_id=${publicationId}::uuid`,
  );
  await tx.execute(
    sql`DELETE FROM odyssey_progress WHERE publication_id=${publicationId}::uuid AND scope_id IN (SELECT id FROM workspaces WHERE publication_id=${publicationId}::uuid)`,
  );
  await tx.execute(
    sql`UPDATE workspaces SET publication_id=NULL WHERE publication_id=${publicationId}::uuid`,
  );
  await tx.execute(sql`
    DELETE FROM interview_question_snapshots q USING interviews i
    WHERE i.id=q.session_id AND i.state='closed' AND q.fixture->'problem'->>'id'=${publicationId}
      AND NOT EXISTS (SELECT 1 FROM interview_execution e WHERE e.session_id=q.session_id AND e.fixture_id=q.id)
      AND NOT EXISTS (SELECT 1 FROM runner_job_inputs j WHERE j.session_id=q.session_id AND j.fixture_id=q.id)
      AND NOT EXISTS (SELECT 1 FROM interview_active_runner_inputs a WHERE a.session_id=q.session_id AND a.fixture_id=q.id)
  `);
  await tx.execute(
    sql`DELETE FROM question_drafts WHERE published_publication_id=${publicationId}::uuid OR edit_publication_id=${publicationId}::uuid`,
  );
}
