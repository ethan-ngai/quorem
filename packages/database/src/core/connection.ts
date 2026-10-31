/** @file connection.ts @description Bounded PostgreSQL transaction scopes. @module database */
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Client, Pool, type PoolClient } from 'pg';
import { classifyDatabaseError, DatabaseFailure, isDefinitiveServerError } from './errors.ts';

export type Transaction = Pick<NodePgDatabase, 'select' | 'selectDistinct' | 'insert' | 'update' | 'delete' | 'execute' | 'with' | '$with'>;
export interface TransactionOptions { statementTimeoutMs: number; lockTimeoutMs: number; isolation?: 'read committed' | 'repeatable read' | 'serializable'; readOnly?: boolean }
export interface ConnectionScope { transaction<T>(options: TransactionOptions, callback: (tx: Transaction) => Promise<T>): Promise<T> }
export interface ScopeOptions { signal?: AbortSignal; lifetimeMs: number }
export interface ConnectionOptions extends ScopeOptions { connectionTimeoutMs: number }
export interface NodePoolOptions { connectionString: string; max: number; connectionTimeoutMs: number; idleTimeoutMs: number; onIdleError: (error: Error) => void }

function positive(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) throw new RangeError(`${name} must be a positive 32-bit integer`);
}

export function createNodePool(options: NodePoolOptions): Pool {
  positive(options.max, 'max');
  if (options.max > 64) throw new RangeError('max must not exceed 64');
  positive(options.connectionTimeoutMs, 'connectionTimeoutMs');
  positive(options.idleTimeoutMs, 'idleTimeoutMs');
  const pool = new Pool({ connectionString: options.connectionString, max: options.max, connectionTimeoutMillis: options.connectionTimeoutMs, idleTimeoutMillis: options.idleTimeoutMs });
  pool.on('error', options.onIdleError);
  return pool;
}

type OwnedClient = Client | PoolClient;
type Release = (destroy: boolean) => void | Promise<void>;

async function runScope<T>(client: OwnedClient, release: Release, signal: AbortSignal | undefined, callback: (scope: ConnectionScope) => Promise<T>): Promise<T> {
  let released = false;
  let closing: Promise<void> | undefined;
  let active = true;
  let inTransaction = false;
  let committing = false;
  let broken = false;
  const close = (destroy: boolean): Promise<void> => {
    if (!released) { released = true; closing = Promise.resolve(release(destroy)); }
    return closing ?? Promise.resolve();
  };
  const db = drizzle(client);
  const tx: Transaction = {
    select: db.select.bind(db), selectDistinct: db.selectDistinct.bind(db),
    insert: db.insert.bind(db), update: db.update.bind(db), delete: db.delete.bind(db),
    execute: db.execute.bind(db), with: db.with.bind(db), $with: db.$with.bind(db),
  };
  const scope: ConnectionScope = {
    async transaction(options, action) {
      if (!active || inTransaction) throw new Error('Connection scope is unavailable');
      positive(options.statementTimeoutMs, 'statementTimeoutMs');
      positive(options.lockTimeoutMs, 'lockTimeoutMs');
      const begin = { 'read committed': 'BEGIN ISOLATION LEVEL READ COMMITTED', 'repeatable read': 'BEGIN ISOLATION LEVEL REPEATABLE READ', serializable: 'BEGIN ISOLATION LEVEL SERIALIZABLE' }[options.isolation ?? 'read committed'];
      if (typeof begin !== 'string') throw new RangeError('Invalid transaction isolation');
      inTransaction = true;
      let began = false;
      try {
        await client.query(options.readOnly ? `${begin} READ ONLY` : begin);
        began = true;
        await db.execute(sql`select set_config('statement_timeout', ${String(options.statementTimeoutMs)}, true), set_config('lock_timeout', ${String(options.lockTimeoutMs)}, true)`);
        let txOpen = true;
        const guarded = new Proxy(tx, {
          get(target, key, receiver) {
            const method = Reflect.get(target, key, receiver);
            if (typeof method !== 'function') return method;
            return (...args: unknown[]) => {
              if (!active || !txOpen) throw new Error('Transaction is no longer active');
              return Reflect.apply(method, target, args);
            };
          },
        });
        const value = await Promise.resolve().then(() => action(guarded)).finally(() => { txOpen = false; });
        if (!active) throw new DatabaseFailure('aborted');
        committing = true;
        try { await client.query('COMMIT'); }
        catch (error) {
          broken = true;
          const kind = classifyDatabaseError(error);
          if (kind === 'connection' || !isDefinitiveServerError(error)) throw new DatabaseFailure('unknown_commit', error);
          throw error;
        } finally { committing = false; }
        return value;
      } catch (error) {
        if (!began) broken = true;
        if (began && active && !broken) {
          try { await client.query('ROLLBACK'); } catch { broken = true; }
        }
        throw error;
      } finally { inTransaction = false; }
    },
  };
  let rejectFailure: (error: DatabaseFailure) => void = () => {};
  let clientFailure: DatabaseFailure | undefined;
  const failed = new Promise<never>((_, reject) => { rejectFailure = reject; });
  void failed.catch(() => {});
  const onClientError = (error: Error): void => {
    broken = true;
    active = false;
    clientFailure ??= new DatabaseFailure(committing ? 'unknown_commit' : 'connection', error);
    rejectFailure(clientFailure);
    void close(true).catch(() => {});
  };
  client.on('error', onClientError);
  if (signal?.aborted) {
    try { await close(true); } finally { client.removeListener('error', onClientError); }
    throw new DatabaseFailure('aborted');
  }
  let abort: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => {
      active = false;
      reject(new DatabaseFailure(committing ? 'unknown_commit' : 'aborted'));
      void close(true).catch(() => {});
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    const value = await Promise.race([callback(scope), cancelled, failed]);
    if (inTransaction) { broken = true; throw new Error('Transaction outlived connection scope'); }
    outcome = { ok: true, value };
  } catch (error) {
    if (classifyDatabaseError(error) === 'connection') broken = true;
    outcome = { ok: false, error };
  }
  active = false;
  if (abort) signal?.removeEventListener('abort', abort);
  let cleanupError: unknown;
  try { await close(broken || inTransaction); } catch (error) { cleanupError = error; }
  client.removeListener('error', onClientError);
  if (!outcome.ok) throw outcome.error;
  if (clientFailure) throw clientFailure;
  if (cleanupError !== undefined) throw cleanupError;
  return outcome.value;
}

export async function withNodeConnection<T>(pool: Pool, options: ScopeOptions, callback: (scope: ConnectionScope) => Promise<T>): Promise<T> {
  positive(options.lifetimeMs, 'lifetimeMs');
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(options.lifetimeMs)]) : AbortSignal.timeout(options.lifetimeMs);
  if (signal.aborted) throw new DatabaseFailure('aborted');
  let cancelled = false;
  let abort: (() => void) | undefined;
  const pending = pool.connect().then((client) => { if (cancelled) client.release(true); return client; });
  const stopped = new Promise<never>((_, reject) => {
    abort = () => { cancelled = true; reject(new DatabaseFailure('aborted')); };
    signal?.addEventListener('abort', abort, { once: true });
  });
  try {
    const client = await Promise.race([pending, stopped]);
    if (signal?.aborted) { client.release(true); throw new DatabaseFailure('aborted'); }
    if (abort) signal?.removeEventListener('abort', abort);
    return await runScope(client, (destroy) => client.release(destroy), signal, callback);
  } finally { if (abort) signal?.removeEventListener('abort', abort); }
}

export async function withWorkerConnection<T>(connectionString: string, options: ConnectionOptions, callback: (scope: ConnectionScope) => Promise<T>): Promise<T> {
  positive(options.connectionTimeoutMs, 'connectionTimeoutMs');
  positive(options.lifetimeMs, 'lifetimeMs');
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(options.lifetimeMs)]) : AbortSignal.timeout(options.lifetimeMs);
  if (signal.aborted) throw new DatabaseFailure('aborted');
  const client = new Client({ connectionString, connectionTimeoutMillis: options.connectionTimeoutMs });
  let cancelled = false;
  let abort: (() => void) | undefined;
  const pending = client.connect().then(() => { if (cancelled) void client.end().catch(() => {}); });
  const stopped = new Promise<never>((_, reject) => {
    abort = () => { cancelled = true; void client.end().catch(() => {}); reject(new DatabaseFailure('aborted')); };
    signal.addEventListener('abort', abort, { once: true });
  });
  let connected = false;
  try {
    await Promise.race([pending, stopped]);
    connected = true;
    if (signal.aborted) { await client.end(); throw new DatabaseFailure('aborted'); }
    if (abort) signal.removeEventListener('abort', abort);
    return await runScope(client, () => client.end(), signal, callback);
  } catch (error) {
    if (!connected && !cancelled) await client.end().catch(() => {});
    throw error;
  } finally { if (abort) signal.removeEventListener('abort', abort); }
}
