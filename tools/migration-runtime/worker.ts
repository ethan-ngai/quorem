/** @file worker.ts @description Workerd PostgreSQL transaction probe. @module migration-runtime */
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';

interface Env { DB: { connectionString: string } }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const client = new Client({ connectionString: env.DB.connectionString, application_name: 'quorem-runtime-spike' });
    await client.connect();
    try {
      const db = drizzle(client);
      const path = new URL(request.url).pathname;
      if (path === '/throw') throw new Error('cleanup sentinel');
      if (path === '/hold') {
        const result = await db.execute(sql`select pg_backend_pid() as pid, pg_sleep(0.4)`);
        return Response.json(result.rows[0]);
      }
      if (path === '/cleanup') {
        const result = await db.execute(sql`select count(*)::int as count from pg_stat_activity where application_name = 'quorem-runtime-spike' and pid <> pg_backend_pid()`);
        return Response.json(result.rows[0]);
      }
      await db.execute(sql`create table if not exists runtime_spike (id integer primary key, value text, big bigint, amount numeric, bytes bytea)`);
      await db.execute(sql`delete from runtime_spike`);
      const committed = await db.transaction(async (tx) => {
        const first = await tx.execute(sql`select pg_backend_pid() as pid`);
        await tx.execute(sql`insert into runtime_spike values (1, 'committed', 9223372036854775807, 12345678901234567890.123456789, decode('0001ff80', 'hex'))`);
        const second = await tx.execute(sql`select pg_backend_pid() as pid`);
        return [first.rows[0].pid, second.rows[0].pid];
      });
      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`insert into runtime_spike (id, value) values (2, 'rolled back')`);
          throw new Error('rollback sentinel');
        });
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'rollback sentinel') throw error;
      }
      const rows = await db.execute(sql`select id, value, big, amount, bytes from runtime_spike order by id`);
      const row = rows.rows[0];
      // A second request-scoped connection contends while the first holds the row lock.
      const contender = new Client({ connectionString: env.DB.connectionString, application_name: 'quorem-runtime-spike' });
      await contender.connect();
      let lockCode = '';
      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`select id from runtime_spike where id = 1 for update`);
          const other = drizzle(contender);
          try {
            await other.transaction(async (otx) => {
              await otx.execute(sql`set local lock_timeout = '150ms'`);
              await otx.execute(sql`update runtime_spike set value = 'unexpected' where id = 1`);
            });
          } catch (error) {
            let current: unknown = error;
            while (current instanceof Error) {
              if ('code' in current && typeof current.code === 'string') lockCode = current.code;
              current = current.cause;
            }
          }
        });
      } finally { await contender.end(); }
      const afterLock = await db.execute(sql`update runtime_spike set value = 'released' where id = 1 returning value`);
      return Response.json({ afterLock: afterLock.rows[0].value, committed, count: rows.rows.length, value: row.value, big: row.big, amount: row.amount, bytes: Buffer.from(row.bytes as Uint8Array).toString('hex'), lockCode });
    } finally { await client.end(); }
  },
};
