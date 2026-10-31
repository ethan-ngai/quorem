/** @file socket-lifecycle.test.ts @description Workerd PostgreSQL client lifecycle. @module api */
/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from 'cloudflare:test';
import { expect, test } from 'vitest';
import { sql } from 'drizzle-orm';
import { classifyDatabaseError, withWorkerConnection } from '@quorem/database/core';
const url = (env as unknown as { SOCKET_TEST_URL: string }).SOCKET_TEST_URL;
test('closes repeated PostgreSQL scopes without unhandled errors', async () => {
  const parsed = new URL(url);
  expect([parsed.hostname, parsed.port, parsed.pathname]).toEqual(['127.0.0.1', '55455', '/quorem_hono_socket_test']);
  for (let i = 0; i < 5; i++) {
    const value = await withWorkerConnection(url, { connectionTimeoutMs: 1000, lifetimeMs: 3000 }, (scope) => scope.transaction({ statementTimeoutMs: 1000, lockTimeoutMs: 500 }, async (tx) => (await tx.execute<{ n: number }>(sql`select 1 as n`)).rows[0].n));
    expect(value).toBe(1);
  }
});

test('Worker TLS connection encrypts transport and closes cleanly', async () => {
  const tls = new URL(url);
  tls.searchParams.set('sslmode', 'verify-full');
  const encrypted = await withWorkerConnection(tls.toString(), { connectionTimeoutMs: 1000, lifetimeMs: 3000 }, (scope) => scope.transaction({ statementTimeoutMs: 1000, lockTimeoutMs: 500 }, async (tx) => (await tx.execute<{ ssl: boolean }>(sql`select ssl from pg_stat_ssl where pid=pg_backend_pid()`)).rows[0].ssl));
  expect(encrypted).toBe(true);
});

test('unexpected server termination rejects an owned scope', async () => {
  let reportPid: (value: number) => void = () => {};
  const ready = new Promise<number>((resolve) => { reportPid = resolve; });
  let release: () => void = () => {};
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const target = withWorkerConnection(url, { connectionTimeoutMs: 1000, lifetimeMs: 3000 }, async (scope) => {
    const pid = await scope.transaction({ statementTimeoutMs: 1000, lockTimeoutMs: 500 }, async (tx) => (await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0].pid);
    reportPid(pid);
    await waiting;
    return 'unexpected';
  });
  const result = target.then(() => 'success', (error: unknown) => error);
  const pid = await ready;
  try {
    const terminated = await withWorkerConnection(url, { connectionTimeoutMs: 1000, lifetimeMs: 3000 }, (scope) => scope.transaction({ statementTimeoutMs: 1000, lockTimeoutMs: 500 }, async (tx) => (await tx.execute<{ ok: boolean }>(sql`select pg_terminate_backend(${pid}) as ok`)).rows[0].ok));
    expect(terminated).toBe(true);
    const error = await result;
    expect(error).toBeInstanceOf(Error);
    expect(classifyDatabaseError(error)).toBe('connection');
  } finally { release(); }
});


test('server termination during a query remains a failure', async () => {
  let reportPid: (value: number) => void = () => {};
  const ready = new Promise<number>((resolve) => { reportPid = resolve; });
  const target = withWorkerConnection(url, { connectionTimeoutMs: 1000, lifetimeMs: 3000 }, (scope) => scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 500 }, async (tx) => {
    const pid = (await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0].pid;
    reportPid(pid);
    await tx.execute(sql`select pg_sleep(2)`);
    return 'unexpected';
  }));
  const result = target.then(() => 'success', (error: unknown) => error);
  const pid = await ready;
  await withWorkerConnection(url, { connectionTimeoutMs: 1000, lifetimeMs: 3000 }, (scope) => scope.transaction({ statementTimeoutMs: 1000, lockTimeoutMs: 500 }, async (tx) => { await tx.execute(sql`select pg_terminate_backend(${pid})`); }));
  expect(await result).toBeInstanceOf(Error);
});
