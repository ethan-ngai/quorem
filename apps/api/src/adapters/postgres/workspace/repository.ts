/** @file repository.ts @description Workspace identity and Odyssey persistence. @module workspace */
import { sql } from 'drizzle-orm';
import type { ConnectionScope, Transaction } from '@quorem/database/core';
import { JsonNumber, parseLosslessJson, stringifyLosslessJson, type JsonValue } from '@quorem/questions';
import { ApplicationError } from '../../../application/error.ts';
import type { Principal } from '../../../modules/identity/model.ts';
import type { Workspace, WorkspaceLanguage, WorkspaceRepository } from '../../../modules/workspace/model.ts';
import { lookupGuestInTransaction } from '../identity/guest.ts';
import { publicOdysseyLevels, visibleProblem } from '../problems/queries/public-projection.ts';

type Run = <T>(callback: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const options = { statementTimeoutMs: 3000, lockTimeoutMs: 1000 };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const missing = () => new ApplicationError('not_found', 'Workspace not found', 404);
type Row = { id: string; kind: 'solo' | 'match'; problemVersionId: string; language: WorkspaceLanguage; matchId: string | null };
function dto(row: Row): Workspace {
  return { id: row.id, kind: row.kind, problemVersionId: row.problemVersionId, language: row.language, ...(row.matchId ? { matchId: row.matchId } : {}) };
}
async function lockUser(tx: Transaction, principal: Principal, reset = false): Promise<void> {
  const lock = reset ? sql`FOR NO KEY UPDATE` : sql`FOR SHARE`;
  const rows = await tx.execute(sql`SELECT id FROM users WHERE id=${principal.userId} AND NOT disabled ${lock}`);
  if (!rows.rows.length) throw missing();
}
async function workspace(tx: Transaction, principal: Principal, id: string): Promise<Workspace> {
  if (!uuid.test(id)) throw missing();
  const row = (await tx.execute<Row>(sql`SELECT w.id::text,w.kind,w.problem_version_id::text AS "problemVersionId",w.language,w.match_id::text AS "matchId" FROM workspaces w JOIN problem_versions v ON v.id=w.problem_version_id JOIN problems p ON p.id=v.problem_id WHERE w.id=${id}::uuid AND w.owner_id=${principal.userId} AND ${visibleProblem({ userId: principal.userId }, true)} FOR SHARE OF w,p`)).rows[0];
  if (!row) throw missing();
  if (row.kind === 'solo') {
    if (principal.kind === 'guest') throw missing();
    const visible = await tx.execute(sql`SELECT v.id FROM problem_versions v JOIN problems p ON p.id=v.problem_id WHERE v.id=${row.problemVersionId}::uuid AND ${visibleProblem({ userId: principal.userId }, false)}`);
    if (!visible.rows.length) throw missing();
  } else {
    if (!row.matchId || (principal.kind === 'guest' && (principal.scope.kind !== 'match' || principal.scope.matchId !== row.matchId))) throw missing();
    const membership = await tx.execute(sql`SELECT m.id FROM matches m JOIN match_participants mp ON mp.match_id=m.id AND mp.owner_id=${principal.userId} AND NOT mp.forfeited JOIN users host ON host.id=m.host_owner_id AND NOT host.disabled WHERE m.id=${row.matchId}::uuid AND m.problem_version_id=${row.problemVersionId}::uuid AND m.state IN ('active','finalizing') FOR SHARE OF m,mp,host`);
    if (!membership.rows.length) throw missing();
    if (principal.kind === 'guest') {
      const live = await lookupGuestInTransaction(tx, 'match', principal.sessionId);
      if (!live || live.userId !== principal.userId || live.scope.kind !== 'match' || live.scope.matchId !== row.matchId) throw missing();
    }
  }
  return dto(row);
}
async function progress(tx: Transaction, owner: string, w: Workspace): Promise<string> {
  const row = (await tx.execute<{ total: number | null; level: number; completed: boolean; levels: string | null; lossless: Uint8Array | null; statuses: string }>(sql`SELECT CASE WHEN jsonb_typeof(v.odyssey->'levels')='array' THEN jsonb_array_length(v.odyssey->'levels') ELSE NULL END AS total,COALESCE(o.level,1) AS level,COALESCE(o.completed,false) AS completed,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('title',stage.value->'title','statementMarkdown',stage.value->'statementMarkdown','methods',stage.value->'methods','examples',stage.value->'examples') ORDER BY stage.ordinality),'[]'::jsonb)::text FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v.odyssey->'levels')='array' THEN v.odyssey->'levels' ELSE '[]'::jsonb END) WITH ORDINALITY stage(value,ordinality) WHERE stage.ordinality<=COALESCE(o.level,1)) AS levels,
    v.lossless_stages AS lossless,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('index',idx,'status',status) ORDER BY idx),'[]'::jsonb)::text FROM (SELECT DISTINCT ON ((c->>'index')::int) (c->>'index')::int AS idx,c->>'status' AS status FROM submissions s CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.result->'publicCases')='array' THEN s.result->'publicCases' ELSE '[]'::jsonb END) c WHERE s.workspace_id=w.id AND s.owner_id=${owner} AND s.state='completed' AND NOT s.custom_run AND s.odyssey_level IS NOT NULL AND s.admitted_at>=COALESCE(o.reset_at,'-infinity'::timestamptz) AND c->>'status' IS NOT NULL ORDER BY (c->>'index')::int,s.admitted_at DESC,s.id DESC) evaluated) AS statuses
    FROM workspaces w JOIN problem_versions v ON v.id=w.problem_version_id LEFT JOIN odyssey_progress o ON o.scope_id=w.id AND o.problem_version_id=w.problem_version_id WHERE w.id=${w.id}::uuid AND w.owner_id=${owner}`)).rows[0];
  if (!row) throw missing();
  if (row.total === null || row.level < 1 || row.level > row.total || row.levels === null) throw new ApplicationError('invalid_input', 'Workspace is not Odyssey', 400);
  const levels = parseLosslessJson(publicOdysseyLevels(row.levels, row.lossless, row.level));
  const statuses = parseLosslessJson(row.statuses);
  const value: { [key: string]: JsonValue } = { totalLevels: new JsonNumber(String(row.total)), level: new JsonNumber(String(row.level)), completed: row.completed, levels };
  if (Array.isArray(statuses) && statuses.length) value.caseStatuses = statuses;
  return stringifyLosslessJson(value);
}
/** Each operation owns a bounded transaction; admission takes the same owner lock as reset. */
export function workspaceRepository(run: Run): WorkspaceRepository {
  return {
    async create(principal, problemVersionId, language) {
      if (!uuid.test(problemVersionId)) throw new ApplicationError('invalid_input', 'Invalid problem ID', 400);
      if (principal.kind === 'guest') throw new ApplicationError('forbidden', 'Guest access is limited to your match', 403);
      return run((scope) => scope.transaction(options, async (tx) => {
        await lockUser(tx, principal);
        const problem = await tx.execute(sql`SELECT v.id FROM problem_versions v JOIN problems p ON p.id=v.problem_id WHERE v.id=${problemVersionId}::uuid AND ${visibleProblem({ userId: principal.userId }, false)} FOR SHARE OF p`);
        if (!problem.rows.length) throw new ApplicationError('not_found', 'Problem not found', 404);
        if (!(await tx.execute(sql`SELECT 1 FROM problem_languages WHERE version_id=${problemVersionId}::uuid AND language=${language}`)).rows.length) throw new ApplicationError('invalid_input', 'Language unavailable for this problem', 400);
        const row = (await tx.execute<Row>(sql`INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES(${crypto.randomUUID()},${principal.userId},${problemVersionId}::uuid,${language}) ON CONFLICT(owner_id,problem_version_id,language) WHERE kind='solo' DO UPDATE SET owner_id=EXCLUDED.owner_id RETURNING id::text,kind,problem_version_id::text AS "problemVersionId",language,match_id::text AS "matchId"`)).rows[0];
        return dto(row);
      }));
    },
    async read(principal, id) { return run((scope) => scope.transaction(options, async (tx) => { await lockUser(tx, principal); return workspace(tx, principal, id); })); },
    async odyssey(principal, id) { return run((scope) => scope.transaction(options, async (tx) => { await lockUser(tx, principal); const w = await workspace(tx, principal, id); return progress(tx, principal.userId, w); })); },
    async reset(principal, id) {
      return run((scope) => scope.transaction(options, async (tx) => {
        await lockUser(tx, principal, true);
        const w = await workspace(tx, principal, id);
        if (w.kind !== 'solo') throw new ApplicationError('not_found', 'Practice workspace not found', 404);
        await progress(tx, principal.userId, w);
        const active = (await tx.execute<{ busy: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM submissions WHERE workspace_id=${w.id}::uuid AND state IN ('queued','running')) AS busy`)).rows[0].busy;
        if (active) throw new ApplicationError('revision_conflict', 'Wait for judging to finish before resetting progress', 409);
        await tx.execute(sql`INSERT INTO odyssey_progress(scope_id,problem_version_id,level,completed,reset_at) VALUES(${w.id}::uuid,${w.problemVersionId}::uuid,1,false,clock_timestamp()) ON CONFLICT(scope_id,problem_version_id) DO UPDATE SET level=1,completed=false,reset_at=clock_timestamp()`);
        return progress(tx, principal.userId, w);
      }));
    },
  };
}
