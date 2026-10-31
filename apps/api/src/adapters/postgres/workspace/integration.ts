/** @file integration.ts @description Workspace PostgreSQL conformance. @module workspace */
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { createNodePool, withNodeConnection, type ConnectionScope } from '@quorem/database/core';
import { migrate } from '@quorem/database/migrations';
import type { LocalPrincipal, GuestPrincipal } from '../../../modules/identity/model.ts';
import { guestTokenHash, newGuestToken } from '../../../modules/identity/guest/credentials.ts';
import { workspaceRepository } from './repository.ts';

const url = process.env.QUOREM_WORKSPACE_TEST_DATABASE_URL;
if (!url || !['postgres:', 'postgresql:'].includes(new URL(url).protocol) || new URL(url).searchParams.has('host') || new URL(url).pathname !== '/quorem_hono_workspace_test' || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) throw new Error('Disposable workspace database required');
const pool = createNodePool({ connectionString: url, max: 8, connectionTimeoutMs: 1000, idleTimeoutMs: 1000, onIdleError: (error) => { throw error; } });
const run = <T>(f: (scope: ConnectionScope) => Promise<T>) => withNodeConnection(pool, { lifetimeMs: 5000 }, f);
const repo = workspaceRepository(run);
const actor = (userId: string): LocalPrincipal => ({ kind: 'local', userId, displayName: userId, admin: false, emailVerified: true, sessionId: 'local', strongUntil: 0 });
const alice = actor('workspace-alice'), bob = actor('workspace-bob'), host = actor('workspace-host');
const problem = crypto.randomUUID(), version = crypto.randomUUID(), privateProblem = crypto.randomUUID(), privateVersion = crypto.randomUUID(), match = crypto.randomUUID(), matchWorkspace = crypto.randomUUID();
const credential = newGuestToken(); let hash = '', workspaceId = '';
const levels = { levels: [ { title: 'level one', statementMarkdown: 'one', hiddenCases: 'STAGE SECRET', methods: [{ className: 'X', methodName: 'm', parameters: [], returnType: 'int', secret: 'METHOD SECRET' }], examples: [{ args: ['clean'], expected: 1, secret: 'EXAMPLE SECRET' }] }, { title: 'SECRET FUTURE', statementMarkdown: 'two', methods: [], examples: [{ args: ['clean'], expected: 2 }] } ] };
const sidecar = '{"problem":{"odyssey":{"levels":[{"examples":[{"args":["public\\u0000first"],"expected":9007199254740993,"secret":"SIDECAR SECRET"}]},{"examples":[{"args":["public\\u0000second"],"expected":9007199254740995}]}]}}}';
before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await migrate(pool, 'product', resolve('../../apps/api/migrations'));
  hash = await guestTokenHash(credential);
  await pool.query("insert into users(id,display_name,kind) values('workspace-alice','Alice','account'),('workspace-bob','Bob','account'),('workspace-host','Host','account'),('workspace-guest','Guest','guest')");
  await pool.query("insert into problems(id,slug,owner_id) values($1,'workspace-public',null),($2,'workspace-private','workspace-host')", [problem, privateProblem]);
  for (const [p,v] of [[problem,version],[privateProblem,privateVersion]]) {
    await pool.query("insert into problem_versions(id,problem_id,version,title,difficulty,statement_markdown,signature,constraints,limits,attribution,odyssey,lossless_stages,lossless_fixture) values($1,$2,1,'Title','easy','statement','{}'::jsonb,'[]'::jsonb,'{}'::jsonb,'fixture',$3::jsonb,$4,$5)", [v,p,JSON.stringify(levels),Buffer.from(sidecar),Buffer.from('SECRET HIDDEN')]);
    await pool.query("insert into problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) values($1,'python','starter','runtime','harness','SECRET REFERENCE')", [v]);
    await pool.query('update problems set current_version_id=$1 where id=$2', [v,p]);
  }
  await pool.query("insert into matches(id,host_owner_id,invite_hash,expires_at,duration_minutes,state,difficulties,started_at,problem_version_id) values($1,'workspace-host','workspace-invite',clock_timestamp()+interval '1 hour',30,'active',ARRAY['easy'],clock_timestamp(),$2)", [match,privateVersion]);
  await pool.query("insert into match_participants(match_id,owner_id,seat) values($1,'workspace-guest',1)", [match]);
  await pool.query("insert into guest_sessions(token_hash,owner_id,match_id,expires_at) values($1,'workspace-guest',$2,clock_timestamp()+interval '1 hour')", [hash,match]);
  await pool.query("insert into workspaces(id,owner_id,problem_version_id,language,kind,match_id) values($1,'workspace-guest',$2,'python','match',$3)", [matchWorkspace,privateVersion,match]);
});
after(async () => { await pool.end(); });
void test('workspace identity is owner and language scoped under concurrent creation', async () => {
  const values = await Promise.all(Array.from({ length: 6 }, () => repo.create(alice, version, 'python')));
  assert.equal(new Set(values.map((v) => v.id)).size, 1); workspaceId = values[0].id;
  assert.deepEqual(await repo.read(alice, workspaceId), values[0]);
  await assert.rejects(repo.read(bob, workspaceId), (e: unknown) => e instanceof Error && 'code' in e && e.code === 'not_found');
  await assert.rejects(repo.create(alice, version, 'java'), (e: unknown) => e instanceof Error && 'code' in e && e.code === 'invalid_input');
  await assert.rejects(repo.create(alice, privateVersion, 'python'), (e: unknown) => e instanceof Error && 'code' in e && e.code === 'not_found');
  assert.equal((await repo.create(host, privateVersion, 'python')).problemVersionId, privateVersion);
});
void test('unlocked stages preserve exact public sidecars and redact future/private data', async () => {
  let raw = await repo.odyssey(alice, workspaceId);
  assert.ok(raw.includes('public\\u0000first')); assert.ok(raw.includes('9007199254740993'));
  assert.equal(raw.includes('SIDECAR SECRET'), false); assert.equal(raw.includes('STAGE SECRET'), false); assert.equal(raw.includes('METHOD SECRET'), false); assert.equal(raw.includes('EXAMPLE SECRET'), false);
  assert.equal(raw.includes('SECRET FUTURE'), false); assert.equal(raw.includes('SECRET HIDDEN'), false); assert.equal(raw.includes('SECRET REFERENCE'), false);
  await pool.query('insert into odyssey_progress(scope_id,problem_version_id,level) values($1,$2,2)', [workspaceId,version]);
  raw = await repo.odyssey(alice, workspaceId);
  assert.ok(raw.includes('SECRET FUTURE')); assert.ok(raw.includes('9007199254740995')); assert.ok(raw.includes('public\\u0000second'));
});
void test('reset fences active jobs and excludes pre-reset feedback on initial row', async () => {
  await pool.query('delete from odyssey_progress where scope_id=$1', [workspaceId]);
  const old = crypto.randomUUID();
  await pool.query("insert into submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases,result,odyssey_level,admitted_at) values($1,'workspace-alice',$2,'submit','x','hash','completed','[]'::jsonb,$3::jsonb,1,clock_timestamp()-interval '1 minute')", [old,workspaceId,JSON.stringify({publicCases:[{index:0,status:'accepted'}]})]);
  assert.match(await repo.odyssey(alice, workspaceId), /accepted/);
  const reset = await repo.reset(alice, workspaceId);
  assert.equal(reset.includes('accepted'), false);
  assert.equal(JSON.parse(reset).level, 1);
  const saved = (await pool.query("select reset_at > '-infinity'::timestamptz as has_epoch from odyssey_progress where scope_id=$1", [workspaceId])).rows[0];
  assert.equal(saved.has_epoch, true);
  for (const [status, custom] of [['wrong_answer', false], ['accepted', false], ['private_ignored', true]] as const) {
    await pool.query("insert into submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases,result,odyssey_level,custom_run) values($1,'workspace-alice',$2,'submit','x','hash','completed','[]'::jsonb,$3::jsonb,1,$4)", [crypto.randomUUID(),workspaceId,JSON.stringify({publicCases:[{index:0,status}]}),custom]);
    await delay(5);
  }
  const feedback = await repo.odyssey(alice, workspaceId);
  assert.equal(JSON.parse(feedback).caseStatuses[0].status, 'accepted');
  assert.equal(feedback.includes('private_ignored'), false);
  const blocker = await pool.connect();
  try {
    await blocker.query('begin'); await blocker.query("select id from users where id='workspace-alice' for no key update");
    const pending = repo.reset(alice, workspaceId); await delay(50);
    await blocker.query("insert into submissions(id,owner_id,workspace_id,kind,source,source_hash,state,cases,odyssey_level) values($1,'workspace-alice',$2,'submit','x','hash','queued','[]'::jsonb,1)", [crypto.randomUUID(),workspaceId]);
    await blocker.query('commit');
    await assert.rejects(pending, (e: unknown) => e instanceof Error && 'code' in e && e.code === 'revision_conflict');
  } finally { blocker.release(); }
  await pool.query("update submissions set state='cancelled' where workspace_id=$1 and state='queued'", [workspaceId]);
  assert.equal(JSON.parse(await repo.reset(alice, workspaceId)).level, 1);
});
void test('guest private match workspace requires live scoped membership and credential', async () => {
  const guest: GuestPrincipal = { kind: 'guest', userId: 'workspace-guest', displayName: 'Guest', admin: false, emailVerified: false, strongUntil: 0, credentialExpiresAt: 9999999999, sessionId: hash, scope: { kind: 'match', matchId: match } };
  assert.equal((await repo.read(guest, matchWorkspace)).problemVersionId, privateVersion);
  await assert.rejects(repo.create(guest, version, 'python'));
  const wrongScope: GuestPrincipal = { ...guest, scope: { kind: 'interview', interviewId: crypto.randomUUID() } };
  await assert.rejects(repo.read(wrongScope, matchWorkspace));
  await pool.query("update match_participants set forfeited=true where owner_id='workspace-guest'");
  await assert.rejects(repo.read(guest, matchWorkspace));
  await pool.query("update match_participants set forfeited=false where owner_id='workspace-guest'");
  await pool.query("update users set disabled=true where id='workspace-host'");
  await assert.rejects(repo.read(guest, matchWorkspace));
  await pool.query("update users set disabled=false where id='workspace-host'");
  await pool.query('update guest_sessions set revoked_at=clock_timestamp() where token_hash=$1', [hash]);
  await assert.rejects(repo.read(guest, matchWorkspace), (e: unknown) => e instanceof Error && 'code' in e && e.code === 'not_found');
});
void test('real HTTP routes require identity and preserve response contracts', async () => {
  const { createApp } = await import('../../../app.ts');
  const { workspaceRoutes } = await import('../../../modules/workspace/routes.ts');
  const { developmentIdentity } = await import('../identity/repository.ts');
  const { IdentityError } = await import('../../../modules/identity/model.ts');
  const { GuestOriginDenied } = await import('../../../modules/identity/guest/credentials.ts');
  const app = createApp({ allowedOrigins: [], requestId: () => 'workspace-request' }).route('/', workspaceRoutes({ repository: repo, identify: async (request) => { if (request.headers.get('authorization') === 'bad') throw new IdentityError('unauthorized'); if (request.headers.get('authorization') === 'outage') throw new IdentityError('unavailable'); if (request.headers.get('authorization') === 'origin') throw new GuestOriginDenied(); return run((scope) => developmentIdentity(scope, alice.userId)); } }));
  const response = await app.request('/v1/workspaces', { method: 'POST', body: JSON.stringify({ problemVersionId: version, language: 'python' }) });
  assert.equal(response.status, 201); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-request-id'), 'workspace-request');
  assert.equal((await response.json()).id, workspaceId);
  assert.equal((await app.request(`/v1/workspaces/${workspaceId}`, { headers: { authorization: 'bad' } })).status, 401);
  assert.equal((await app.request(`/v1/workspaces/${workspaceId}`, { headers: { authorization: 'origin' } })).status, 403);
  assert.equal((await app.request(`/v1/workspaces/${workspaceId}`, { headers: { authorization: 'outage' } })).status, 503);
  const { serve } = await import('@hono/node-server');
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!server.listening) await new Promise<void>((done) => server.once('listening', done));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('listener unavailable');
    for (const [authorization, status] of [['bad', 401], ['origin', 403], ['outage', 503]] as const) {
      const result: Response = await fetch(`http://127.0.0.1:${address.port}/v1/workspaces/${workspaceId}`, { headers: { authorization } });
      assert.equal(result.status, status);
      assert.equal(result.headers.get('x-request-id'), 'workspace-request');
    }
  } finally { await new Promise<void>((done, fail) => server.close((error) => error ? fail(error) : done())); }
  assert.equal((await app.request('/v1/workspaces', { method: 'POST', body: JSON.stringify({ problemVersionId: version, language: 'python', ownerId: 'other' }) })).status, 400);
  assert.equal((await app.request('/v1/workspaces/not-uuid/odyssey')).status, 400);
  const anonymous = createApp({ allowedOrigins: [], requestId: () => 'anonymous' }).route('/', workspaceRoutes({ repository: repo, identify: async () => undefined }));
  assert.equal((await anonymous.request(`/v1/workspaces/${workspaceId}`)).status, 401);
});
