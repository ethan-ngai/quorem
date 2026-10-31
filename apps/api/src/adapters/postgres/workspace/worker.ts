/** @file worker.ts @description Workerd workspace against disposable PostgreSQL. @module workspace */
/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { withWorkerConnection, type ConnectionScope } from '@quorem/database/core';
import { createApp } from '../../../app.ts';
import { workspaceRoutes } from '../../../modules/workspace/routes.ts';
import { developmentIdentity } from '../identity/repository.ts';
import { workspaceRepository } from './repository.ts';
const url = (env as unknown as { WORKSPACE_TEST_URL: string }).WORKSPACE_TEST_URL;
it('authenticates and reads real workspace and Odyssey in workerd', async () => {
  const parsed = new URL(url);
  expect([parsed.hostname, parsed.port, parsed.pathname]).toEqual(['127.0.0.1', '55451', '/quorem_hono_workspace_test']);
  const run = <T>(callback: (scope: ConnectionScope) => Promise<T>) => withWorkerConnection(url, { lifetimeMs: 5000, connectionTimeoutMs: 1000 }, callback);
  const user = crypto.randomUUID();
  const version = await run((scope) => scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
    await tx.execute(sql`insert into users(id,display_name) values(${user},'Worker')`);
    return (await tx.execute<{ id: string }>(sql`select current_version_id::text as id from problems where slug='workspace-public'`)).rows[0].id;
  }));
  const repo = workspaceRepository(run);
  const app = createApp({ allowedOrigins: [], requestId: () => 'worker-request' }).route('/', workspaceRoutes({ repository: repo, identify: () => run((scope) => developmentIdentity(scope, user)) }));
  const created = await app.request('/v1/workspaces', { method: 'POST', body: JSON.stringify({ problemVersionId: version, language: 'python' }) });
  expect(created.status).toBe(201);
  const workspace = await created.json() as { id: string };
  const read = await app.request(`/v1/workspaces/${workspace.id}`);
  expect(read.status).toBe(200); expect(read.headers.get('cache-control')).toBe('no-store');
  const progress = await app.request(`/v1/workspaces/${workspace.id}/odyssey`);
  const raw = await progress.text();
  expect(progress.status).toBe(200); expect(raw).toContain('9007199254740993'); expect(raw).not.toContain('SECRET FUTURE'); expect(raw).not.toContain('SECRET HIDDEN');
  expect((await app.request(`/v1/workspaces/${workspace.id}/odyssey/reset`, { method: 'POST' })).status).toBe(200);
});

it('revalidates a private match guest against live PostgreSQL', async () => {
  const { guestRepository } = await import('../identity/guest.ts');
  const { guestTokenHash, newGuestToken } = await import('../../../modules/identity/guest/credentials.ts');
  const run = <T>(callback: (scope: ConnectionScope) => Promise<T>) => withWorkerConnection(url, { lifetimeMs: 5000, connectionTimeoutMs: 1000 }, callback);
  const owner = crypto.randomUUID(), match = crypto.randomUUID(), workspace = crypto.randomUUID();
  const hash = await guestTokenHash(newGuestToken());
  await run((scope) => scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
    const version = (await tx.execute<{ id: string }>(sql`select current_version_id::text as id from problems where slug='workspace-private'`)).rows[0].id;
    await tx.execute(sql`insert into users(id,display_name,kind) values(${owner},'Guest','guest')`);
    await tx.execute(sql`insert into matches(id,host_owner_id,invite_hash,expires_at,duration_minutes,state,difficulties,started_at,problem_version_id) values(${match},'workspace-host',${crypto.randomUUID()},clock_timestamp()+interval '1 hour',30,'active',ARRAY['easy'],clock_timestamp(),${version})`);
    await tx.execute(sql`insert into match_participants(match_id,owner_id,seat) values(${match},${owner},1)`);
    await tx.execute(sql`insert into guest_sessions(token_hash,owner_id,match_id,expires_at) values(${hash},${owner},${match},clock_timestamp()+interval '1 hour')`);
    await tx.execute(sql`insert into workspaces(id,owner_id,problem_version_id,language,kind,match_id) values(${workspace},${owner},${version},'python','match',${match})`);
  }));
  const guest = await run((scope) => guestRepository(scope).lookup('match', hash));
  expect(guest).not.toBeNull();
  const repo = workspaceRepository(run);
  expect((await repo.read(guest!, workspace)).id).toBe(workspace);
  await run((scope) => scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => { await tx.execute(sql`update guest_sessions set revoked_at=clock_timestamp() where token_hash=${hash}`); }));
  await expect(repo.read(guest!, workspace)).rejects.toMatchObject({ code: 'not_found' });
});
