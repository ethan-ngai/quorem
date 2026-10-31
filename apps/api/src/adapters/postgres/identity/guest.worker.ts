/** @file guest.worker.test.ts @description Workerd guest PostgreSQL integration. @module identity */
/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { withWorkerConnection, type ConnectionScope } from '@quorem/database/core';
import { guestRepository, publicGuestBudget } from './guest.ts';
import { guestTokenHash, newGuestToken } from '../../../modules/identity/guest/credentials.ts';
const url = (env as unknown as { GUEST_TEST_URL: string }).GUEST_TEST_URL;
it('uses real request-scoped PostgreSQL and observes revocation', async () => {
  const parsed = new URL(url);
  expect([parsed.hostname, parsed.port, parsed.pathname]).toEqual(['127.0.0.1', '55448', '/quorem_hono_guest_test']);
  const run = <T>(action: (scope: ConnectionScope) => Promise<T>) => withWorkerConnection(url, { connectionTimeoutMs: 1000, lifetimeMs: 5000 }, action);
  const owner = crypto.randomUUID(), host = crypto.randomUUID(), match = crypto.randomUUID();
  const hash = await guestTokenHash(newGuestToken());
  await run((scope) => scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => {
    await tx.execute(sql`INSERT INTO users(id,display_name,kind) VALUES(${host},'Host','account'),(${owner},'Guest','guest')`);
    await tx.execute(sql`INSERT INTO matches(id,host_owner_id,invite_hash,expires_at,duration_minutes,state,difficulties) VALUES(${match},${host},${crypto.randomUUID()},clock_timestamp()+interval '1 hour',30,'waiting',ARRAY['easy'])`);
    await tx.execute(sql`INSERT INTO match_participants(match_id,owner_id,seat) VALUES(${match},${owner},1)`);
    await tx.execute(sql`INSERT INTO guest_sessions(token_hash,owner_id,match_id,expires_at) VALUES(${hash},${owner},${match},clock_timestamp()+interval '1 hour')`);
  }));
  expect((await run((scope) => guestRepository(scope).lookup('match', hash)))?.scope).toEqual({ kind: 'match', matchId: match });
  await run((scope) => scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => { await tx.execute(sql`UPDATE guest_sessions SET revoked_at=clock_timestamp() WHERE token_hash=${hash}`); }));
  expect(await run((scope) => guestRepository(scope).lookup('match', hash))).toBeNull();
  await run((scope) => scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, async (tx) => { await tx.execute(sql`DELETE FROM guest_request_buckets`); }));
  expect(await run((scope) => publicGuestBudget(scope).allow('workerd-peer'))).toBe(true);
});
