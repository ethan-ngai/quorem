/** @file guest.integration.test.ts @description Disposable guest PostgreSQL integration. @module identity */
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { createNodePool, withNodeConnection, type ConnectionScope } from '@quorem/database/core';
import { migrate } from '@quorem/database/migrations';
import { guestRepository, publicGuestBudget, revokeGuestInTransaction } from './guest.ts';
import { guestTokenHash, newGuestToken } from '../../../modules/identity/guest/credentials.ts';

const url = process.env.QUOREM_GUEST_TEST_DATABASE_URL;
if (!url || new URL(url).port !== '55448' || new URL(url).pathname !== '/quorem_hono_guest_test' || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) throw new Error('Disposable guest database required');
const pool = createNodePool({ connectionString: url, max: 6, connectionTimeoutMs: 1000, idleTimeoutMs: 1000, onIdleError: (error) => { throw error; } });
const run = <T>(fn: (scope: ConnectionScope) => Promise<T>) => withNodeConnection(pool, { lifetimeMs: 5000 }, fn);
const match = crypto.randomUUID(), interview = crypto.randomUUID();
const matchToken = newGuestToken(), interviewToken = newGuestToken();
let matchHash = '', interviewHash = '';
before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await migrate(pool, 'product', resolve('../../apps/api/migrations'));
  matchHash = await guestTokenHash(matchToken); interviewHash = await guestTokenHash(interviewToken);
  await pool.query("insert into users(id,display_name,kind) values('host','Host','account'),('match-guest','Match guest','guest'),('interview-guest','Interview guest','guest')");
  await pool.query("insert into matches(id,host_owner_id,invite_hash,expires_at,duration_minutes,state,difficulties) values($1,'host','invite',now()+interval '1 hour',30,'waiting',ARRAY['easy'])", [match]);
  await pool.query("insert into match_participants(match_id,owner_id,seat) values($1,'match-guest',1)", [match]);
  await pool.query("insert into guest_sessions(token_hash,owner_id,match_id,expires_at) values($1,'match-guest',$2,now()+interval '1 hour')", [matchHash, match]);
  await pool.query("insert into interviews(id,host_id,title,question,language,source,document_epoch,question_epoch,invite_hash,invite_token,interviewer_invite_hash,interviewer_invite_token) values($1,'host','Interview','{}'::jsonb,'python','',$2,$3,'invite-i','i','invite-j','j')", [interview, crypto.randomUUID(), crypto.randomUUID()]);
  await pool.query("insert into interview_members(session_id,user_id,role) values($1,'interview-guest','interviewee')", [interview]);
  await pool.query("insert into interview_guest_sessions(token_hash,owner_id,session_id,expires_at) values($1,'interview-guest',$2,now()+interval '1 hour')", [interviewHash, interview]);
});
after(async () => { await pool.end(); });
void test('scope-specific live identity follows membership and host revocation', async () => {
  await pool.query("update guest_sessions set last_seen_at=clock_timestamp()-interval '10 minutes' where token_hash=$1", [matchHash]);
  const matchGuest = await run((scope) => guestRepository(scope).lookup('match', matchHash));
  assert.equal((await pool.query("select last_seen_at>clock_timestamp()-interval '1 minute' as fresh from guest_sessions where token_hash=$1", [matchHash])).rows[0].fresh, true);
  assert.equal(matchGuest?.kind, 'guest');
  assert.deepEqual(matchGuest?.scope, { kind: 'match', matchId: match });
  assert.equal(matchGuest?.admin, false); assert.equal(matchGuest?.emailVerified, false);
  assert.equal(await run((scope) => guestRepository(scope).lookup('interview', matchHash)), null);
  assert.deepEqual((await run((scope) => guestRepository(scope).lookup('interview', interviewHash)))?.scope, { kind: 'interview', interviewId: interview });
  await pool.query("update interview_guest_sessions set revoked_at=clock_timestamp() where token_hash=$1", [interviewHash]);
  assert.equal(await run((scope) => guestRepository(scope).lookup('interview', interviewHash)), null);
  await pool.query('update interview_guest_sessions set revoked_at=null where token_hash=$1', [interviewHash]);
  await pool.query("update users set disabled=true where id='host'");
  assert.equal(await run((scope) => guestRepository(scope).lookup('match', matchHash)), null);
  assert.equal(await run((scope) => guestRepository(scope).lookup('interview', interviewHash)), null);
  await pool.query("update users set disabled=false where id='host'");
  await pool.query("update interview_members set removed_at=now() where user_id='interview-guest'");
  assert.equal(await run((scope) => guestRepository(scope).lookup('interview', interviewHash)), null);
  await pool.query("update interview_members set removed_at=null where user_id='interview-guest'");
  await pool.query("update users set disabled=true where id='match-guest'");
  assert.equal(await run((scope) => guestRepository(scope).lookup('match', matchHash)), null);
  await pool.query("update users set disabled=false where id='match-guest'");
  await pool.query("delete from match_participants where owner_id='match-guest'");
  assert.equal(await run((scope) => guestRepository(scope).lookup('match', matchHash)), null);
  await pool.query("insert into match_participants(match_id,owner_id,seat) values($1,'match-guest',1)", [match]);
});
void test('expiry and inactivity are rechecked after row-lock waits', async () => {
  const blocker = await pool.connect();
  try {
    await pool.query("update guest_sessions set expires_at=clock_timestamp()+interval '200 milliseconds' where token_hash=$1", [matchHash]);
    await blocker.query('begin'); await blocker.query('select token_hash from guest_sessions where token_hash=$1 for update', [matchHash]);
    const pending = run((scope) => guestRepository(scope).lookup('match', matchHash));
    await delay(350); await blocker.query('commit');
    assert.equal(await pending, null);
    await pool.query("update guest_sessions set expires_at=clock_timestamp()+interval '1 hour',last_seen_at=clock_timestamp()-interval '2 hours' where token_hash=$1", [matchHash]);
    assert.equal(await run((scope) => guestRepository(scope).lookup('match', matchHash)), null);
    await pool.query('update guest_sessions set last_seen_at=clock_timestamp() where token_hash=$1', [matchHash]);
    await pool.query("update interview_guest_sessions set expires_at=clock_timestamp()+interval '200 milliseconds' where token_hash=$1", [interviewHash]);
    await blocker.query('begin'); await blocker.query('select token_hash from interview_guest_sessions where token_hash=$1 for update', [interviewHash]);
    const other = run((scope) => guestRepository(scope).lookup('interview', interviewHash));
    await delay(350); await blocker.query('commit');
    assert.equal(await other, null);
  } finally { blocker.release(); }
});
void test('revocation while waiting cannot authenticate and end rechecks expiry', async () => {
  const blocker = await pool.connect();
  try {
    await blocker.query('begin');
    await blocker.query('select token_hash from guest_sessions where token_hash=$1 for update', [matchHash]);
    const lookup = run((scope) => guestRepository(scope).lookup('match', matchHash));
    await delay(50);
    await blocker.query('update guest_sessions set revoked_at=clock_timestamp() where token_hash=$1', [matchHash]);
    await blocker.query('commit');
    assert.equal(await lookup, null);
    await pool.query("update guest_sessions set revoked_at=null,expires_at=clock_timestamp()+interval '200 milliseconds' where token_hash=$1", [matchHash]);
    await pool.query("update match_participants set forfeited=true where owner_id='match-guest'");
    await blocker.query('begin'); await blocker.query('select id from matches where id=$1 for update', [match]);
    const end = run((scope) => guestRepository(scope).endMatch(matchHash));
    await delay(350); await blocker.query('commit');
    assert.equal(await end, false);
    await pool.query("update guest_sessions set expires_at=clock_timestamp()+interval '1 hour' where token_hash=$1", [matchHash]);
    await pool.query("update match_participants set forfeited=false where owner_id='match-guest'");
  } finally { blocker.release(); }
});
void test('active seat cannot end; forfeited seat revokes immediately', async () => {
  assert.equal(await run((scope) => guestRepository(scope).endMatch(matchHash)), false);
  await pool.query("update match_participants set forfeited=true where owner_id='match-guest'");
  assert.equal(await run((scope) => guestRepository(scope).endMatch(matchHash)), true);
  assert.equal(await run((scope) => guestRepository(scope).lookup('match', matchHash)), null);
  assert.equal(await run((scope) => guestRepository(scope).endMatch(matchHash)), false);
  await pool.query("update guest_sessions set revoked_at=null where token_hash=$1", [matchHash]);
  await pool.query("update match_participants set forfeited=false where owner_id='match-guest'");
  await pool.query("update matches set state='completed',outcome='{}'::jsonb where id=$1", [match]);
  assert.equal(await run((scope) => guestRepository(scope).endMatch(matchHash)), true);
});
void test('global and peer budgets commit atomically under contention', async () => {
  if (Number((await pool.query("select extract(second from clock_timestamp())::float8 as second")).rows[0].second) > 59) await delay(1100);
  await pool.query('truncate guest_request_buckets');
  await pool.query("insert into guest_request_buckets(key,window_start,used) values('global',date_trunc('minute',clock_timestamp()),5999)");
  const results = await Promise.all(['peer-a', 'peer-b'].map((peer) => run((scope) => publicGuestBudget(scope).allow(peer))));
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal((await pool.query("select used from guest_request_buckets where key='global'")).rows[0].used, 6000);
  assert.equal((await pool.query("select count(*)::int as n from guest_request_buckets where key like 'peer:%'")).rows[0].n, 1);
});
void test('peer exhaustion rolls back global accounting and dependency outages fail closed', async () => {
  if (Number((await pool.query("select extract(second from clock_timestamp())::float8 as second")).rows[0].second) > 59) await delay(1100);
  await pool.query('truncate guest_request_buckets');
  const peer = 'limited-peer';
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(peer))), (byte) => byte.toString(16).padStart(2, '0')).join('');
  await pool.query("insert into guest_request_buckets(key,window_start,used) values($1,date_trunc('minute',clock_timestamp()),1200)", [`peer:${hash}`]);
  assert.equal(await run((scope) => publicGuestBudget(scope).allow(peer)), false);
  assert.equal((await pool.query("select count(*)::int as n from guest_request_buckets where key='global'")).rows[0].n, 0);
  const dead = createNodePool({ connectionString: url!, max: 1, connectionTimeoutMs: 1000, idleTimeoutMs: 1000, onIdleError: () => {} });
  await dead.end();
  const { allowPublicGuestRequest } = await import('../../../modules/access/guest.ts');
  await assert.rejects(allowPublicGuestRequest(peer, { allow: (value) => withNodeConnection(dead, { lifetimeMs: 1000 }, (scope) => publicGuestBudget(scope).allow(value)) }), (error: unknown) => error instanceof Error && 'kind' in error && error.kind === 'unavailable');
});

void test('aggregate-owned revocation is transaction-bound and scope-limited', async () => {
  await pool.query("update interview_guest_sessions set expires_at=clock_timestamp()+interval '1 hour',revoked_at=null where token_hash=$1", [interviewHash]);
  const changed = await run((scope) => scope.transaction({ statementTimeoutMs: 1000, lockTimeoutMs: 500 }, (tx) => revokeGuestInTransaction(tx, { kind: 'interview', interviewId: interview }, 'interview-guest')));
  assert.equal(changed, true);
  assert.equal(await run((scope) => guestRepository(scope).lookup('interview', interviewHash)), null);
  assert.equal(await run((scope) => scope.transaction({ statementTimeoutMs: 1000, lockTimeoutMs: 500 }, (tx) => revokeGuestInTransaction(tx, { kind: 'interview', interviewId: interview }, 'interview-guest'))), false);
});
