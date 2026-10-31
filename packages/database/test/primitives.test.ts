/** @file primitives.test.ts @description PostgreSQL transaction and lifetime tests. @module database */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { sql } from 'drizzle-orm';
import { Client } from 'pg';
import type { Transaction } from '../src/core/index.ts';
import { classifyDatabaseError, createNodePool, withNodeConnection, withWorkerConnection } from '../src/core/index.ts';

const url = process.env.QUOREM_TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/quorem_hono_primitives_test' || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) throw new Error('QUOREM_TEST_DATABASE_URL must name the disposable quorem_hono_primitives_test database');
const pool = createNodePool({ connectionString: url, max: 1, connectionTimeoutMs: 250, idleTimeoutMs: 1000, onIdleError: (error) => { throw error; } });
const options = { statementTimeoutMs: 1000, lockTimeoutMs: 100 };
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const run = <T>(callback: Parameters<typeof withNodeConnection<T>>[2]) => withNodeConnection(pool, { lifetimeMs: 3000 }, callback);
before(async () => { await pool.query('CREATE TABLE IF NOT EXISTS primitives_probe (id int primary key, value text)'); await pool.query('DELETE FROM primitives_probe'); await pool.query('CREATE TABLE IF NOT EXISTS primitives_deferred (value int, UNIQUE(value) DEFERRABLE INITIALLY DEFERRED)'); await pool.query('DELETE FROM primitives_deferred'); });
after(async () => { await pool.query('DROP TABLE IF EXISTS primitives_deferred'); await pool.query('DROP TABLE IF EXISTS primitives_probe'); await pool.end(); });

void test('commit, rollback, pinned client and classified wrapped constraints', async () => {
  let retained: Transaction | undefined;
  const pids = await run((scope) => scope.transaction(options, async (tx) => {
    retained = tx;
    const first = await tx.execute(sql`select pg_backend_pid() as pid`);
    await tx.execute(sql`insert into primitives_probe values (1, 'ok')`);
    const second = await tx.execute(sql`select pg_backend_pid() as pid`);
    return [first.rows[0].pid, second.rows[0].pid];
  }));
  assert.equal(pids[0], pids[1]);
  const mode = await run((scope) => scope.transaction({ ...options, isolation: 'repeatable read', readOnly: true }, async (tx) => (await tx.execute(sql`select current_setting('transaction_isolation') as isolation, current_setting('transaction_read_only') as readonly`)).rows[0]));
  assert.equal(mode.isolation, 'repeatable read');
  assert.equal(mode.readonly, 'on');
  assert.throws(() => retained?.execute(sql`select 1`), /no longer active/);
  await assert.rejects(run((scope) => scope.transaction(options, async (tx) => { await tx.execute(sql`insert into primitives_probe values (2, 'rollback')`); throw new Error('sentinel'); })), /sentinel/);
  await assert.rejects(run((scope) => scope.transaction(options, async (tx) => { await tx.execute(sql`insert into primitives_probe values (1, 'duplicate')`); })), (error) => classifyDatabaseError(error) === 'unique');
  assert.equal((await pool.query('select count(*)::int as n from primitives_probe')).rows[0].n, 1);
});

void test('commit constraint failure remains a definite unique violation', async () => {
  await assert.rejects(run((scope) => scope.transaction(options, async (tx) => {
    await tx.execute(sql`insert into primitives_deferred values (1), (1)`);
  })), (error) => classifyDatabaseError(error) === 'unique');
  assert.equal((await pool.query('select count(*)::int as n from primitives_deferred')).rows[0].n, 0);
});

void test('statement and lock deadlines with rollback', async () => {
  await assert.rejects(run((scope) => scope.transaction({ ...options, statementTimeoutMs: 50 }, async (tx) => { await tx.execute(sql`select pg_sleep(1)`); })), (error) => classifyDatabaseError(error) === 'query_cancelled');
  const blocker = new Client({ connectionString: url }); await blocker.connect();
  try {
    await blocker.query('BEGIN'); await blocker.query('select id from primitives_probe where id=1 for update');
    await assert.rejects(run((scope) => scope.transaction(options, async (tx) => { await tx.execute(sql`update primitives_probe set value='blocked' where id=1`); })), (error) => classifyDatabaseError(error) === 'lock_timeout');
  } finally { await blocker.query('ROLLBACK'); await blocker.end(); }
  assert.equal((await pool.query('select value from primitives_probe where id=1')).rows[0].value, 'ok');
});

void test('abort active work destroys borrowed client and leaves no writes', async () => {
  const controller = new AbortController();
  const pending = withNodeConnection(pool, { lifetimeMs: 3000, signal: controller.signal }, (scope) => scope.transaction(options, async (tx) => { await tx.execute(sql`insert into primitives_probe values (3, 'abort')`); await tx.execute(sql`select pg_sleep(2)`); }));
  await delay(100); controller.abort();
  await assert.rejects(pending, (error) => classifyDatabaseError(error) === 'aborted');
  await delay(100);
  assert.equal((await pool.query('select count(*)::int as n from primitives_probe where id=3')).rows[0].n, 0);
});

void test('scope lifetime bounds stalled callbacks', async () => {
  await assert.rejects(withNodeConnection(pool, { lifetimeMs: 40 }, async () => { await delay(200); }), (error) => classifyDatabaseError(error) === 'aborted');
  assert.equal((await pool.query('select 1 as n')).rows[0].n, 1);
});

void test('pool exhaustion and aborted waiter release late acquisition', async () => {
  const held = await pool.connect();
  const controller = new AbortController();
  const waiting = withNodeConnection(pool, { lifetimeMs: 3000, signal: controller.signal }, async () => 'unreachable');
  controller.abort();
  await assert.rejects(waiting, (error) => classifyDatabaseError(error) === 'aborted');
  await assert.rejects(withNodeConnection(pool, { lifetimeMs: 3000 }, async () => 'unreachable'), /timeout/i);
  held.release(); await delay(100);
  assert.equal(pool.waitingCount, 0);
  assert.equal((await pool.query('select 1 as n')).rows[0].n, 1);
});

void test('concurrent waiters isolate cancellation', async () => {
  const held = await pool.connect();
  const controller = new AbortController();
  const cancelled = withNodeConnection(pool, { lifetimeMs: 3000, signal: controller.signal }, async () => 'unexpected');
  const next = withNodeConnection(pool, { lifetimeMs: 3000 }, async (scope) => scope.transaction(options, async (tx) => (await tx.execute(sql`select 42 as value`)).rows[0].value));
  const rejection = assert.rejects(cancelled, (error) => classifyDatabaseError(error) === 'aborted');
  controller.abort();
  await rejection;
  held.release();
  assert.equal(await next, 42);
  assert.equal(pool.waitingCount, 0);
});

void test('worker-shaped scope closes on success and abort', async () => {
  const pid = await withWorkerConnection(url, { connectionTimeoutMs: 1000, lifetimeMs: 3000 }, (scope) => scope.transaction(options, async (tx) => (await tx.execute(sql`select pg_backend_pid() as pid`)).rows[0].pid));
  assert.equal((await pool.query('select count(*)::int as n from pg_stat_activity where pid = $1', [pid])).rows[0].n, 0);
  const controller = new AbortController();
  const pending = withWorkerConnection(url, { connectionTimeoutMs: 1000, lifetimeMs: 3000, signal: controller.signal }, (scope) => scope.transaction(options, async (tx) => { await tx.execute(sql`select pg_sleep(2)`); }));
  await delay(100); controller.abort();
  await assert.rejects(pending, (error) => classifyDatabaseError(error) === 'aborted');
});

void test('idle borrowed and Worker clients reject on backend loss', async () => {
  const killer = new Client({ connectionString: url }); await killer.connect();
  try {
    for (const kind of ['node', 'worker'] as const) {
      const ready = deferred<unknown>();
      const release = deferred<void>();
      const callback = async (scope: import('../src/core/index.ts').ConnectionScope): Promise<string> => {
        const pid = await scope.transaction(options, async (tx) => (await tx.execute(sql`select pg_backend_pid() as pid`)).rows[0].pid);
        ready.resolve(pid);
        await release.promise;
        return 'should not succeed';
      };
      const pending = kind === 'node' ? run(callback) : withWorkerConnection(url, { connectionTimeoutMs: 1000, lifetimeMs: 3000 }, callback);
      const rejection = assert.rejects(pending, (error) => classifyDatabaseError(error) === 'connection');
      const pid = await ready.promise;
      await killer.query('select pg_terminate_backend($1)', [pid]);
      await rejection;
      release.resolve(undefined);
      assert.equal((await killer.query('select count(*)::int as n from pg_stat_activity where pid = $1', [pid])).rows[0].n, 0);
      assert.equal((await pool.query('select 1 as n')).rows[0].n, 1);
    }
  } finally { await killer.end(); }
});

void test('lost acknowledgment during COMMIT is unknown without replay', async () => {
  let calls = 0;
  const killer = new Client({ connectionString: url }); await killer.connect();
  await killer.query(`create table primitives_commit_probe (value int)`);
  await killer.query(`create function primitives_commit_delay() returns trigger language plpgsql as $$ begin perform pg_sleep(5); return new; end $$`);
  await killer.query(`create constraint trigger primitives_commit_delay_trigger after insert on primitives_commit_probe deferrable initially deferred for each row execute function primitives_commit_delay()`);
  try {
    const ready = deferred<unknown>();
    const pending = run((scope) => scope.transaction({ ...options, statementTimeoutMs: 10000 }, async (tx) => {
      calls++;
      const pid = (await tx.execute(sql`select pg_backend_pid() as pid`)).rows[0].pid;
      await tx.execute(sql`insert into primitives_commit_probe values (1)`);
      ready.resolve(pid);
    }));
    const rejection = assert.rejects(pending, (error) => classifyDatabaseError(error) === 'unknown_commit');
    const pid = await ready.promise;
    let committing = false;
    for (let i = 0; i < 100; i++) {
      const result = await killer.query("select state = 'active' and query = 'COMMIT' as committing from pg_stat_activity where pid = $1", [pid]);
      if (result.rows[0]?.committing) { committing = true; break; }
      await delay(10);
    }
    assert.equal(committing, true);
    await killer.query('select pg_terminate_backend($1)', [pid]);
    await rejection;
    assert.equal(calls, 1);
  } finally {
    await killer.query('drop table primitives_commit_probe');
    await killer.query('drop function primitives_commit_delay()');
    await killer.end();
  }
});

void test('full Drizzle callback prevents escaped handles and lazy writes', async () => {
  let handle!: import('drizzle-orm/node-postgres').NodePgDatabase;
  let lazy!: ReturnType<typeof handle.execute>;
  await run(async scope => {
    await scope.withDatabase(async db => {
      handle=db;
      assert.throws(()=>Reflect.get(db, '$client'),/Raw database client is unavailable/);
      assert.equal((db._ as unknown as {session?:unknown}).session,undefined);
      lazy=db.execute(sql`insert into primitives_probe values (77, 'late')`);
      const result=await db.execute(sql`select txid_current_if_assigned() as assigned`);
      assert.equal(result.rows[0].assigned,null);
      await assert.rejects(scope.transaction(options,async()=>{}),/unavailable/);
      let transaction!: import('drizzle-orm/node-postgres').NodePgDatabase;
      await db.transaction(async tx=>{transaction=tx; await tx.execute(sql`select 1`);});
      assert.throws(()=>transaction.select(),/transaction is no longer active/);
    });
    assert.throws(()=>handle.select(),/no longer active/);
    assert.throws(()=>lazy.then(()=>{}),/no longer active/);
  });
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM primitives_probe WHERE id=77')).rows[0].n,0);
});

void test('detached Drizzle query destroys scope instead of returning a live connection', async () => {
  await assert.rejects(run(scope=>scope.withDatabase(async db=>{
    void db.execute(sql`select pg_sleep(1)`).then(()=>{},()=>{});
  })),/query outlived callback/);
  await assert.rejects(run(scope=>scope.withDatabase(async db=>{
    void db.execute(sql`select pg_sleep(1)`).then(()=>{},()=>{});
    throw new Error('callback failed');
  })),/callback failed/);
  await run(scope=>scope.transaction(options,async tx=>{await tx.execute(sql`select 1`);}));
});

void test('successful, failed and pre-aborted scopes clear their lifetime timers', async () => {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  const pending = new Set<ReturnType<typeof setTimeout>>();
  let created = 0;
  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, milliseconds?: number, ...args: unknown[]) => {
    const timer = originalSet(callback, milliseconds, ...args);
    if (milliseconds === 123456789) { created++; pending.add(timer); }
    return timer;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
    pending.delete(timer);
    return originalClear(timer);
  }) as typeof clearTimeout;
  try {
    await withNodeConnection(pool, { lifetimeMs: 123456789 }, async () => 'ok');
    await assert.rejects(withNodeConnection(pool, { lifetimeMs: 123456789 }, async () => { throw new Error('fixture'); }));
    await withWorkerConnection(url, { connectionTimeoutMs: 1000, lifetimeMs: 123456789 }, async () => 'ok');
    await assert.rejects(withWorkerConnection(url, { connectionTimeoutMs: 1000, lifetimeMs: 123456789 }, async () => { throw new Error('fixture'); }));
    const controller = new AbortController(); controller.abort();
    await assert.rejects(withNodeConnection(pool, { lifetimeMs: 123456789, signal: controller.signal }, async () => 'unexpected'));
    await assert.rejects(withWorkerConnection(url, { connectionTimeoutMs: 1000, lifetimeMs: 123456789, signal: controller.signal }, async () => 'unexpected'));
    assert.equal(created, 6);
    assert.equal(pending.size, 0);
  } finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; }
});

void test('abort during COMMIT remains unknown for both connection owners', async () => {
  const observer = new Client({ connectionString: url }); await observer.connect();
  await observer.query('CREATE TABLE primitives_abort_commit (value int)');
  await observer.query("CREATE FUNCTION primitives_abort_commit_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(5); RETURN NEW; END $$");
  await observer.query('CREATE CONSTRAINT TRIGGER primitives_abort_commit_trigger AFTER INSERT ON primitives_abort_commit DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION primitives_abort_commit_delay()');
  try {
    for (const kind of ['node', 'worker'] as const) {
      const controller = new AbortController(), ready = deferred<unknown>();
      const callback = (scope: import('../src/core/index.ts').ConnectionScope) => scope.transaction({ ...options, statementTimeoutMs: 10000 }, async (tx) => {
        const pid = (await tx.execute(sql`SELECT pg_backend_pid() AS pid`)).rows[0].pid;
        await tx.execute(sql`INSERT INTO primitives_abort_commit VALUES (1)`);
        ready.resolve(pid);
      });
      const pending = kind === 'node'
        ? withNodeConnection(pool, { lifetimeMs: 10000, signal: controller.signal }, callback)
        : withWorkerConnection(url, { connectionTimeoutMs: 1000, lifetimeMs: 10000, signal: controller.signal }, callback);
      const rejection = assert.rejects(pending, error => classifyDatabaseError(error) === 'unknown_commit');
      const pid = await ready.promise;
      let committing = false;
      for (let i = 0; i < 100; i++) {
        committing = Boolean((await observer.query("SELECT state='active' AND query='COMMIT' AS committing FROM pg_stat_activity WHERE pid=$1", [pid])).rows[0]?.committing);
        if (committing) break;
        await delay(10);
      }
      assert.equal(committing, true);
      controller.abort();
      await rejection;
    }
  } finally {
    await observer.query('DROP TABLE primitives_abort_commit');
    await observer.query('DROP FUNCTION primitives_abort_commit_delay()');
    await observer.end();
  }
});
