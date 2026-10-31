/** @file worker.ts @description Workerd PostgreSQL primitive fixture. @module database */
import { sql } from 'drizzle-orm';
import { classifyDatabaseError, withWorkerConnection } from '../src/core/index.ts';
interface Env { DB: { connectionString: string } }
const deadlines = { statementTimeoutMs: 1000, lockTimeoutMs: 100 };
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const connection = <T>(action: Parameters<typeof withWorkerConnection<T>>[2], signal?: AbortSignal) => withWorkerConnection(env.DB.connectionString, { connectionTimeoutMs: 1000, lifetimeMs: 3000, signal }, action);
    const url = new URL(request.url);
    if (url.pathname === '/activity') {
      const pid = Number(url.searchParams.get('pid'));
      const present = await connection((scope) => scope.transaction(deadlines, async (tx) => (await tx.execute(sql`select count(*)::int as n from pg_stat_activity where pid = ${pid}`)).rows[0].n));
      return Response.json({ present });
    }
    if (url.pathname === '/timeout') {
      try { await connection((scope) => scope.transaction({ ...deadlines, statementTimeoutMs: 50 }, async (tx) => { await tx.execute(sql`select pg_sleep(1)`); })); }
      catch (error) { return Response.json({ kind: classifyDatabaseError(error) }); }
      return Response.json({ kind: 'none' });
    }
    if (url.pathname === '/rollback') {
      await connection((scope) => scope.transaction(deadlines, async (tx) => { await tx.execute(sql`create table if not exists primitives_worker_probe (value int)`); await tx.execute(sql`delete from primitives_worker_probe`); }));
      try { await connection((scope) => scope.transaction(deadlines, async (tx) => { await tx.execute(sql`insert into primitives_worker_probe values (1)`); throw new Error('rollback'); })); } catch (error) { if (!(error instanceof Error) || error.message !== 'rollback') throw error; }
      const count = await connection((scope) => scope.transaction(deadlines, async (tx) => { const rows = await tx.execute(sql`select count(*)::int as n from primitives_worker_probe`); await tx.execute(sql`drop table primitives_worker_probe`); return rows.rows[0].n; }));
      return Response.json({ count });
    }
    if (url.pathname === '/error') {
      let pid: unknown;
      try { await connection((scope) => scope.transaction(deadlines, async (tx) => {
        pid = (await tx.execute(sql`select pg_backend_pid() as pid`)).rows[0].pid;
        throw new Error('sentinel');
      })); } catch (error) { if (!(error instanceof Error) || error.message !== 'sentinel') throw error; }
      return Response.json({ pid });
    }
    if (url.pathname === '/abort') {
      const controller = new AbortController();
      let pid: unknown;
      const operation = connection((scope) => scope.transaction(deadlines, async (tx) => {
        pid = (await tx.execute(sql`select pg_backend_pid() as pid`)).rows[0].pid;
        controller.abort();
        await tx.execute(sql`select pg_sleep(1)`);
      }), controller.signal);
      let kind = 'none';
      try { await operation; } catch (error) { kind = classifyDatabaseError(error); }
      return Response.json({ kind, pid });
    }
    const pid = await connection((scope) => scope.transaction(deadlines, async (tx) => (await tx.execute(sql`select pg_backend_pid() as pid`)).rows[0].pid));
    const present = await connection((scope) => scope.transaction(deadlines, async (tx) => (await tx.execute(sql`select count(*)::int as n from pg_stat_activity where pid = ${pid}`)).rows[0].n));
    return Response.json({ pid, present });
  },
};
