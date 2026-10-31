import assert from 'node:assert/strict';
import { mkdtemp, readdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { is } from 'drizzle-orm';
import { PgTable, pgTable, bigint, numeric } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { bytea } from './core/bytea.ts';
import { migrate } from './migrations.ts';
import * as product from './schema/product/index.ts';
import * as auth from './schema/auth/index.ts';

const url = process.env.QUOREM_SCHEMA_TEST_DATABASE_URL;
test('migration and catalog parity on disposable database', { skip: !url }, async () => {
  assert.equal(new URL(url!).pathname, '/quorem_hono_schema_test');
  assert.equal(new URL(url!).port, '55432');
  const pool = new pg.Pool({connectionString: url});
  const root = resolve(import.meta.dirname, '../../..');
  const productDir = join(root, 'apps/api/migrations');
  const authDir = join(root, 'apps/auth/migrations');
  const temporary = await mkdtemp(join(tmpdir(), 'quorem-migrations-'));
  try {
    await pool.query('DROP SCHEMA IF EXISTS quorem_auth CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    for (const [owner, dir, prefix] of [['product', productDir, 10], ['auth', authDir, 2]] as const) {
      const partial = join(temporary, owner);
      await import('node:fs/promises').then(fs => fs.mkdir(partial));
      const names = (await readdir(dir)).filter(name=>name.endsWith('.sql')).sort();
      for (const name of names.slice(0,prefix)) await copyFile(join(dir,name), join(partial,name));
      await migrate(pool, owner, partial);
      await migrate(pool, owner, dir);
      await migrate(pool, owner, dir);
      const ledger = owner === 'auth' ? 'quorem_auth.schema_migrations' : 'public.schema_migrations';
      assert.equal(Number((await pool.query(`SELECT count(*) FROM ${ledger}`)).rows[0].count),names.length);
      await pool.query(`DELETE FROM ${ledger} WHERE name=$1`,[names[0]]);
      await assert.rejects(migrate(pool,owner,dir),/contiguous prefix/);
      await pool.query(`INSERT INTO ${ledger}(name) VALUES($1)`,[names[0]]);
      await pool.query(`INSERT INTO ${ledger}(name) VALUES('unavailable.sql')`);
      await assert.rejects(migrate(pool,owner,dir),/unavailable/);
      await pool.query(`DELETE FROM ${ledger} WHERE name='unavailable.sql'`);
    }
    const fixture = pgTable('codec_fixture', { id:bigint({mode:'bigint'}), amount:numeric(), payload:bytea('payload') });
    await pool.query('CREATE TEMP TABLE codec_fixture(id bigint, amount numeric, payload bytea)');
    const db=drizzle(pool);
    const bytes=Buffer.from([0,255,128,1]);
    await db.insert(fixture).values({id:9223372036854775807n,amount:'12345678901234567890.123456789',payload:bytes});
    const [decoded]=await db.select().from(fixture);
    assert.equal(decoded.id,9223372036854775807n);
    assert.equal(decoded.amount,'12345678901234567890.123456789');
    assert.deepEqual(decoded.payload,bytes);
    for (const [namespace, definitions] of [['public',product],['quorem_auth',auth]] as const) {
      const tables = Object.values(definitions).filter(value=>is(value,PgTable));
      const actual = await pool.query(`SELECT table_name,column_name,udt_name,is_nullable FROM information_schema.columns WHERE table_schema=$1 ORDER BY table_name,column_name`,[namespace]);
      const expected = tables.flatMap(table=>{const config=getTableConfig(table); return config.columns.map(col=>`${config.name}.${col.name}`);}).sort();
      assert.deepEqual(expected,actual.rows.map(row=>`${row.table_name}.${row.column_name}`).sort());
      const types: Record<string,string> = {text:'text',uuid:'uuid',integer:'int4',boolean:'bool',bigint:'int8',bigserial:'int8','double precision':'float8',jsonb:'jsonb',bytea:'bytea','text[]':'_text','timestamp with time zone':'timestamptz'};
      for (const table of tables) { const config=getTableConfig(table); for (const col of config.columns) { const row=actual.rows.find(row=>row.table_name===config.name && row.column_name===col.name); assert.equal(types[col.getSQLType()],row.udt_name,`${namespace}.${config.name}.${col.name} type`); assert.equal(col.notNull,row.is_nullable==='NO',`${namespace}.${config.name}.${col.name} nullability`); } }

      for (const table of tables) {
        const config=getTableConfig(table);
        const constraints=await pool.query(`SELECT conname FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=$1 AND t.relname=$2 AND c.contype IN ('c','f','u')`,[namespace,config.name]);
        const expectedConstraints=[...config.checks.map(c=>c.name),...config.foreignKeys.map(f=>f.getName()),...config.uniqueConstraints.map(u=>u.name)].sort();
        assert.deepEqual(expectedConstraints,constraints.rows.map(row=>row.conname).sort(),`${namespace}.${config.name} constraints`);
        const foreign = await pool.query(`SELECT c.conname AS name, array_agg(a.attname::text ORDER BY k.ordinality) AS local, array_agg(b.attname::text ORDER BY k.ordinality) AS remote FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN LATERAL unnest(c.conkey,c.confkey) WITH ORDINALITY k(localnum,remotenum,ordinality) ON true JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.localnum JOIN pg_attribute b ON b.attrelid=c.confrelid AND b.attnum=k.remotenum WHERE c.contype='f' AND n.nspname=$1 AND t.relname=$2 GROUP BY c.conname`,[namespace,config.name]);
        const expectedForeign = config.foreignKeys.map(f=>{const ref=f.reference();return {name:f.getName(),local:ref.columns.map(c=>c.name),remote:ref.foreignColumns.map(c=>c.name)};}).sort((a,b)=>a.name.localeCompare(b.name));
        assert.deepEqual(expectedForeign,foreign.rows.sort((a,b)=>a.name.localeCompare(b.name)),`${namespace}.${config.name} foreign keys`);
        const indexes=await pool.query(`SELECT i.relname AS name, array_agg(a.attname::text ORDER BY k.ordinality) AS columns FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_class i ON i.oid=x.indexrelid JOIN LATERAL unnest(x.indkey) WITH ORDINALITY k(attnum,ordinality) ON true LEFT JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum WHERE n.nspname=$1 AND t.relname=$2 AND NOT x.indisprimary GROUP BY i.relname`,[namespace,config.name]);
        const expectedIndexes = [...config.indexes.map(i=>({name:i.config.name!,columns:i.config.columns.map(c=>("name" in c ? c.name : null) ?? null)})),...config.uniqueConstraints.map(u=>({name:u.name!,columns:u.columns.map(c=>c.name)}))].sort((a,b)=>a.name.localeCompare(b.name));
        assert.deepEqual(expectedIndexes,indexes.rows.sort((a,b)=>a.name.localeCompare(b.name)),`${namespace}.${config.name} indexes`);
      }
    }
    const snapshot = async () => (await pool.query(`SELECT 'column' kind, table_schema namespace, table_name object, column_name detail, coalesce(column_default,'') value FROM information_schema.columns WHERE table_schema IN ('public','quorem_auth') UNION ALL SELECT 'constraint', n.nspname, t.relname, c.conname, pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname IN ('public','quorem_auth') UNION ALL SELECT 'index', schemaname, tablename, indexname, indexdef FROM pg_indexes WHERE schemaname IN ('public','quorem_auth') UNION ALL SELECT 'trigger',n.nspname,t.relname,g.tgname,pg_get_triggerdef(g.oid) FROM pg_trigger g JOIN pg_class t ON t.oid=g.tgrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE NOT g.tgisinternal AND n.nspname IN ('public','quorem_auth') UNION ALL SELECT 'function',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','quorem_auth') ORDER BY 1,2,3,4`)).rows;
    const upgraded=await snapshot();
    await pool.query('DROP SCHEMA quorem_auth CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await migrate(pool,'product',productDir);
    await migrate(pool,'auth',authDir);
    assert.deepEqual(await snapshot(),upgraded);
  } finally { await rm(temporary,{recursive:true,force:true}); await pool.end(); }
});
