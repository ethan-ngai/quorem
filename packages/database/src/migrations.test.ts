/** @file migrations.test.ts @description PostgreSQL schema and migration ownership. @module database */
import assert from "node:assert/strict";
import { mkdtemp, readdir, copyFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { passkey } from "@better-auth/passkey";
import { authAdapterSchema } from "./schema/auth/adapter.ts";
import pg from "pg";
import { getTableConfig, getViewConfig, isPgView, PgColumn } from "drizzle-orm/pg-core";
import { is, sql, SQL } from "drizzle-orm";
import { PgTable, PgDialect, pgTable, bigint, numeric } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import { bytea } from "./core/bytea.ts";
import { migrate } from "./migrations.ts";
import * as product from "./schema/product/index.ts";
import * as auth from "./schema/auth/index.ts";

const url = process.env.QUOREM_SCHEMA_TEST_DATABASE_URL;
await test("migration and catalog parity on disposable database", { skip: !url }, async () => {
  assert.equal(new URL(url!).pathname, "/quorem_hono_schema_test");
  assert.ok(
    ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url!).hostname),
    "Schema tests require a loopback disposable database",
  );
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const dialect = new PgDialect();
  const render = (value: unknown) =>
    typeof value === "bigint"
      ? value.toString()
      : dialect.sqlToQuery(
          (is(value, SQL)
            ? value
            : sql`${typeof value === "object" ? JSON.stringify(value) : value}`
          ).inlineParams(),
        ).sql;
  const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
  const root = resolve(import.meta.dirname, "../../..");
  const productDir = join(root, "apps/api/migrations");
  const authDir = join(root, "apps/auth/migrations");
  const temporary = await mkdtemp(join(tmpdir(), "quorem-migrations-"));
  try {
    await pool.query(
      "DROP SCHEMA IF EXISTS quorem_auth CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public",
    );
    for (const [owner, dir, prefix] of [
      ["product", productDir, 10],
      ["auth", authDir, 2],
    ] as const) {
      const partial = join(temporary, owner);
      await import("node:fs/promises").then((fs) => fs.mkdir(partial));
      const names = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
      for (const name of names.slice(0, prefix))
        await copyFile(join(dir, name), join(partial, name));
      await migrate(pool, owner, partial);
      await migrate(pool, owner, dir);
      await migrate(pool, owner, dir);
      const ledger =
        owner === "auth" ? "quorem_auth.schema_migrations" : "public.schema_migrations";
      assert.equal(
        Number((await pool.query(`SELECT count(*) FROM ${ledger}`)).rows[0].count),
        names.length,
      );
      await pool.query(`DELETE FROM ${ledger} WHERE name=$1`, [names[0]]);
      await assert.rejects(migrate(pool, owner, dir), /contiguous prefix/);
      await pool.query(`INSERT INTO ${ledger}(name) VALUES($1)`, [names[0]]);
      await pool.query(`INSERT INTO ${ledger}(name) VALUES('unavailable.sql')`);
      await assert.rejects(migrate(pool, owner, dir), /unavailable/);
      await pool.query(`DELETE FROM ${ledger} WHERE name='unavailable.sql'`);
    }
    const fixture = pgTable("codec_fixture", {
      id: bigint({ mode: "bigint" }),
      amount: numeric(),
      payload: bytea("payload"),
    });
    await pool.query("CREATE TEMP TABLE codec_fixture(id bigint, amount numeric, payload bytea)");
    const db = drizzle(pool);
    const bytes = Buffer.from([0, 255, 128, 1]);
    await db.insert(fixture).values({
      id: 9223372036854775807n,
      amount: "12345678901234567890.123456789",
      payload: bytes,
    });
    const [decoded] = await db.select().from(fixture);
    assert.equal(decoded.id, 9223372036854775807n);
    assert.equal(decoded.amount, "12345678901234567890.123456789");
    assert.deepEqual(decoded.payload, bytes);
    for (const [namespace, definitions] of [
      ["public", product],
      ["quorem_auth", auth],
    ] as const) {
      const tables = Object.values(definitions).filter((value) => is(value, PgTable));
      const views = Object.values(definitions).filter(isPgView);
      const actual = await pool.query(
        `SELECT table_name,column_name,udt_name,is_nullable FROM information_schema.columns WHERE table_schema=$1 ORDER BY table_name,column_name`,
        [namespace],
      );
      const expected = tables
        .flatMap((table) => {
          const config = getTableConfig(table);
          return config.columns.map((col) => `${config.name}.${col.name}`);
        })
        .concat(
          views.flatMap((view) => {
            const config = getViewConfig(view);
            return Object.values(config.selectedFields)
              .filter((col) => is(col, PgColumn))
              .map((col) => `${config.name}.${col.name}`);
          }),
        )
        .sort();
      assert.deepEqual(
        expected,
        actual.rows.map((row) => `${row.table_name}.${row.column_name}`).sort(),
      );
      const types: Record<string, string> = {
        text: "text",
        uuid: "uuid",
        integer: "int4",
        boolean: "bool",
        bigint: "int8",
        bigserial: "int8",
        "double precision": "float8",
        jsonb: "jsonb",
        bytea: "bytea",
        "text[]": "_text",
        "timestamp with time zone": "timestamptz",
      };
      for (const table of tables) {
        const config = getTableConfig(table);
        for (const col of config.columns) {
          const row = actual.rows.find(
            (row) => row.table_name === config.name && row.column_name === col.name,
          );
          assert.equal(
            types[col.getSQLType()],
            row.udt_name,
            `${namespace}.${config.name}.${col.name} type`,
          );
          assert.equal(
            col.notNull,
            row.is_nullable === "NO",
            `${namespace}.${config.name}.${col.name} nullability`,
          );
        }
      }

      for (const view of views) {
        const config = getViewConfig(view);
        for (const col of Object.values(config.selectedFields).filter((value) =>
          is(value, PgColumn),
        )) {
          const row = actual.rows.find(
            (row) => row.table_name === config.name && row.column_name === col.name,
          );
          assert.equal(
            types[col.getSQLType()],
            row.udt_name,
            `${namespace}.${config.name}.${col.name} type`,
          );
          assert.equal(
            col.notNull,
            row.is_nullable === "NO",
            `${namespace}.${config.name}.${col.name} nullability`,
          );
        }
      }

      for (const table of tables) {
        const config = getTableConfig(table);
        await pool.query(
          `CREATE TEMP TABLE parity_probe (LIKE ${quote(namespace)}.${quote(config.name)})`,
        );
        const columns = await pool.query(
          `SELECT a.attname, pg_get_expr(d.adbin,d.adrelid) AS expr, a.attidentity FROM pg_attribute a JOIN pg_class t ON t.oid=a.attrelid JOIN pg_namespace n ON n.oid=t.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum WHERE n.nspname=$1 AND t.relname=$2 AND a.attnum>0 AND NOT a.attisdropped`,
          [namespace, config.name],
        );
        for (const col of config.columns) {
          const actualColumn = columns.rows.find((row) => row.attname === col.name);
          if (col.generatedIdentity || col.getSQLType() === "bigserial") continue;
          assert.equal(
            col.hasDefault,
            actualColumn.expr !== null,
            `${namespace}.${config.name}.${col.name} default presence`,
          );
          if (actualColumn.expr !== null) {
            try {
              await pool.query(
                `ALTER TABLE parity_probe ALTER COLUMN ${quote(col.name)} SET DEFAULT ${render(col.default)}`,
              );
            } catch (e) {
              throw new Error(`${namespace}.${config.name}.${col.name}: ${render(col.default)}`, {
                cause: e,
              });
            }
            const probe = await pool.query(
              `SELECT pg_get_expr(d.adbin,d.adrelid) expr FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid='pg_temp.parity_probe'::regclass AND a.attname=$1`,
              [col.name],
            );
            assert.equal(
              probe.rows[0].expr,
              actualColumn.expr,
              `${namespace}.${config.name}.${col.name} default expression`,
            );
          }
        }
        for (const check of config.checks) {
          await pool.query(
            `ALTER TABLE parity_probe ADD CONSTRAINT parity_check CHECK (${render(check.value)})`,
          );
          const expr = await pool.query(
            `SELECT pg_get_expr(c.conbin,c.conrelid) expr FROM pg_constraint c WHERE c.conname='parity_check' AND c.conrelid='pg_temp.parity_probe'::regclass`,
          );
          const original = await pool.query(
            `SELECT pg_get_expr(c.conbin,c.conrelid) expr FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=$1 AND t.relname=$2 AND c.conname=$3`,
            [namespace, config.name, check.name],
          );
          await pool.query("ALTER TABLE parity_probe DROP CONSTRAINT parity_check");
          await pool.query(
            `ALTER TABLE parity_probe ADD CONSTRAINT parity_check CHECK (${original.rows[0].expr})`,
          );
          const canonical = await pool.query(
            `SELECT pg_get_expr(c.conbin,c.conrelid) expr FROM pg_constraint c WHERE c.conname='parity_check' AND c.conrelid='pg_temp.parity_probe'::regclass`,
          );
          assert.equal(
            expr.rows[0].expr,
            canonical.rows[0].expr,
            `${namespace}.${config.name}.${check.name} check expression`,
          );
          await pool.query("ALTER TABLE parity_probe DROP CONSTRAINT parity_check");
        }
        for (const index of config.indexes) {
          const original = await pool.query(
            `SELECT pg_get_expr(x.indpred,x.indrelid) expr FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_class i ON i.oid=x.indexrelid WHERE n.nspname=$1 AND t.relname=$2 AND i.relname=$3`,
            [namespace, config.name, index.config.name],
          );
          assert.equal(
            Boolean(index.config.where),
            original.rows[0].expr !== null,
            `${namespace}.${config.name}.${index.config.name} predicate presence`,
          );
          if (index.config.where) {
            await pool.query(
              `CREATE INDEX parity_index ON parity_probe (${quote(config.columns[0].name)}) WHERE ${render(index.config.where)}`,
            );
            const probe = await pool.query(
              `SELECT pg_get_expr(x.indpred,x.indrelid) expr FROM pg_index x WHERE x.indexrelid='pg_temp.parity_index'::regclass`,
            );
            assert.equal(
              probe.rows[0].expr,
              original.rows[0].expr,
              `${namespace}.${config.name}.${index.config.name} predicate`,
            );
            await pool.query("DROP INDEX pg_temp.parity_index");
          }
        }
        await pool.query("DROP TABLE parity_probe");
        const constraints = await pool.query(
          `SELECT conname FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=$1 AND t.relname=$2 AND c.contype IN ('c','f','u')`,
          [namespace, config.name],
        );
        const expectedConstraints = [
          ...config.checks.map((c) => c.name),
          ...config.foreignKeys.map((f) => f.getName()),
          ...config.uniqueConstraints.map((u) => u.name),
        ].sort((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));
        assert.deepEqual(
          expectedConstraints,
          constraints.rows.map((row) => row.conname).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
          `${namespace}.${config.name} constraints`,
        );
        const foreign = await pool.query(
          `SELECT c.conname AS name, c.confdeltype::text AS deletion, c.confupdtype::text AS update, (SELECT CASE WHEN nn.nspname='public' THEN tt.relname ELSE nn.nspname || '.' || tt.relname END FROM pg_class tt JOIN pg_namespace nn ON nn.oid=tt.relnamespace WHERE tt.oid=c.confrelid) AS target, array_agg(a.attname::text ORDER BY k.ordinality) AS local, array_agg(b.attname::text ORDER BY k.ordinality) AS remote FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN LATERAL unnest(c.conkey,c.confkey) WITH ORDINALITY k(localnum,remotenum,ordinality) ON true JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.localnum JOIN pg_attribute b ON b.attrelid=c.confrelid AND b.attnum=k.remotenum WHERE c.contype='f' AND n.nspname=$1 AND t.relname=$2 GROUP BY c.conname,c.confdeltype,c.confupdtype,c.confrelid`,
          [namespace, config.name],
        );
        const specialForeign = await pool.query(
          `SELECT c.conname AS name,c.condeferrable,c.condeferred,ARRAY(SELECT a.attname::text FROM unnest(c.confdelsetcols) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum ORDER BY k.ord) AS set_columns FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE c.contype='f' AND n.nspname=$1 AND t.relname=$2`,
          [namespace, config.name],
        );
        for (const fk of specialForeign.rows) {
          const publication = fk.name === "current_publication_identity";
          const deferred = publication || fk.name === "submission_interview_execution_fkey";
          assert.deepEqual(
            { deferrable: fk.condeferrable, deferred: fk.condeferred, setColumns: fk.set_columns },
            {
              deferrable: deferred,
              deferred,
              setColumns: publication ? ["current_version_id"] : [],
            },
            `${namespace}.${config.name}.${fk.name} PostgreSQL-only FK options`,
          );
        }
        const expectedForeign = config.foreignKeys
          .map((f) => {
            const ref = f.reference();
            const actions: Record<string, string> = {
              "no action": "a",
              restrict: "r",
              cascade: "c",
              "set null": "n",
              "set default": "d",
            };
            const target = getTableConfig(ref.foreignTable);
            return {
              name: f.getName(),
              deletion: actions[f.onDelete ?? "no action"],
              update: actions[f.onUpdate ?? "no action"],
              target: target.schema ? `${target.schema}.${target.name}` : target.name,
              local: ref.columns.map((c) => c.name),
              remote: ref.foreignColumns.map((c) => c.name),
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name));
        assert.deepEqual(
          expectedForeign,
          foreign.rows.sort((a, b) => a.name.localeCompare(b.name)),
          `${namespace}.${config.name} foreign keys`,
        );
        const indexes = await pool.query(
          `SELECT i.relname AS name, array_agg(a.attname::text ORDER BY k.ordinality) AS columns FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_class i ON i.oid=x.indexrelid JOIN LATERAL unnest(x.indkey) WITH ORDINALITY k(attnum,ordinality) ON true LEFT JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum WHERE n.nspname=$1 AND t.relname=$2 AND NOT x.indisprimary GROUP BY i.relname`,
          [namespace, config.name],
        );
        const expectedIndexes = [
          ...config.indexes.map((i) => ({
            name: i.config.name!,
            columns: i.config.columns.map((c) => ("name" in c ? c.name : null) ?? null),
          })),
          ...config.uniqueConstraints.map((u) => ({
            name: u.name!,
            columns: u.columns.map((c) => c.name),
          })),
        ].sort((a, b) => a.name.localeCompare(b.name));
        assert.deepEqual(
          expectedIndexes,
          indexes.rows.sort((a, b) => a.name.localeCompare(b.name)),
          `${namespace}.${config.name} indexes`,
        );
      }
    }
    const viewSource = await readFile(
      join(productDir, "051_interview_public_examples.sql"),
      "utf8",
    );
    for (const name of [
      "interview_question_public",
      "interview_snapshot_public",
      "interview_execution_public",
    ]) {
      const start = viewSource.indexOf(`CREATE VIEW ${name} WITH (security_barrier=true) AS`);
      assert.notEqual(start, -1);
      const end = viewSource.indexOf(";", start);
      assert.notEqual(end, -1);
      const viewDDL = viewSource.slice(start, end + 1);
      await pool.query(viewDDL.replace(`CREATE VIEW ${name}`, `CREATE TEMP VIEW parity_${name}`));
      const views = await pool.query(
        `SELECT c.relname,pg_get_viewdef(c.oid,true) AS definition,c.reloptions FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE (n.nspname='public' AND c.relname=$1) OR (n.oid=pg_my_temp_schema() AND c.relname=$2)`,
        [name, `parity_${name}`],
      );
      assert.equal(views.rows.length, 2);
      const original = views.rows.find((row) => row.relname === name),
        probe = views.rows.find((row) => row.relname === `parity_${name}`);
      assert.deepEqual(original.reloptions, ["security_barrier=true"]);
      assert.deepEqual(probe.reloptions, ["security_barrier=true"]);
      assert.equal(original.definition, probe.definition);
    }
    const snapshot = async () =>
      (
        await pool.query(
          `SELECT 'column' kind, table_schema namespace, table_name object, column_name detail, coalesce(column_default,'') value FROM information_schema.columns WHERE table_schema IN ('public','quorem_auth') UNION ALL SELECT 'constraint', n.nspname, t.relname, c.conname, pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname IN ('public','quorem_auth') UNION ALL SELECT 'index', schemaname, tablename, indexname, indexdef FROM pg_indexes WHERE schemaname IN ('public','quorem_auth') UNION ALL SELECT 'trigger',n.nspname,t.relname,g.tgname,pg_get_triggerdef(g.oid) FROM pg_trigger g JOIN pg_class t ON t.oid=g.tgrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE NOT g.tgisinternal AND n.nspname IN ('public','quorem_auth') UNION ALL SELECT 'function',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','quorem_auth') ORDER BY 1,2,3,4`,
        )
      ).rows;
    const upgraded = await snapshot();
    await pool.query(
      "DROP SCHEMA quorem_auth CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public",
    );
    await migrate(pool, "product", productDir);
    await migrate(pool, "auth", authDir);
    assert.deepEqual(await snapshot(), upgraded);
    const service = betterAuth({
      baseURL: "http://localhost:18878",
      secret: "fixture-only-secret-at-least-32-characters-long",
      database: drizzleAdapter(drizzle(pool, { schema: authAdapterSchema }), {
        provider: "pg",
        schema: authAdapterSchema,
      }),
      emailAndPassword: { enabled: true },
      plugins: [
        passkey({ rpID: "localhost", rpName: "Fixture", origin: "http://localhost:18878" }),
      ],
    });
    const call = (path: string, options: RequestInit = {}) => {
      const headers = new Headers(options.headers);
      headers.set("origin", "http://localhost:18878");
      headers.set("content-type", "application/json");
      return service.handler(
        new Request(`http://localhost:18878/api/auth/${path}`, { ...options, headers }),
      );
    };
    const signup = await call("sign-up/email", {
      method: "POST",
      body: JSON.stringify({
        name: "Fixture",
        email: "fixture@example.test",
        password: "fixture password",
      }),
    });
    assert.equal(signup.status, 200, await signup.clone().text());
    const signupData = await signup.json();
    const cookie = signup.headers.get("set-cookie")!.split(";")[0];
    const userId = signupData.user.id;
    await pool.query(
      `INSERT INTO quorem_auth.passkey(id,"publicKey","userId","credentialID",counter,"deviceType","backedUp") VALUES('fixture-key','fixture-public-key',$1,'fixture-credential',4294967295,'singleDevice',false)`,
      [userId],
    );
    const keys = await call("passkey/list-user-passkeys", { headers: { cookie } });
    assert.equal(keys.status, 200, await keys.clone().text());
    const passkeys = await keys.json();
    assert.equal(passkeys[0].counter, 4294967295);
    assert.equal(typeof passkeys[0].counter, "number");
    await pool.query(`UPDATE quorem_auth.passkey SET counter=4294967296 WHERE id='fixture-key'`);
    await assert.rejects(
      drizzle(pool).select().from(auth.passkeyInQuorem_auth),
      /Invalid WebAuthn signature counter/,
    );
    await assert.rejects(
      drizzle(pool).update(auth.passkeyInQuorem_auth).set({ counter: -1 }),
      /Invalid WebAuthn signature counter/,
    );
    await pool.query(`UPDATE quorem_auth.passkey SET counter=4294967295 WHERE id='fixture-key'`);
    await pool.query(
      `INSERT INTO users(id,display_name) VALUES('fixture-user','Fixture'); INSERT INTO identity_bindings(issuer,subject,user_id) VALUES('fixture-issuer','fixture-subject','fixture-user'); INSERT INTO problems(id,slug,owner_id) VALUES('10000000-0000-4000-8000-000000000001','fixture-problem','fixture-user'); INSERT INTO problem_versions(id,version,problem_id,title,difficulty,statement_markdown,signature,constraints,limits,attribution) VALUES('20000000-0000-4000-8000-000000000002',1,'10000000-0000-4000-8000-000000000001','Fixture','easy','fixture','{}','[]','{}','fixture'); INSERT INTO problem_languages(version_id,language,starter_source,runtime_revision,harness_revision,reference_source) VALUES('20000000-0000-4000-8000-000000000002','python','fixture','fixture','fixture','fixture'); INSERT INTO workspaces(id,owner_id,problem_version_id,language) VALUES('30000000-0000-4000-8000-000000000003','fixture-user','20000000-0000-4000-8000-000000000002','python')`,
    );
    await pool.query(`UPDATE identity_bindings SET subject=$1 WHERE user_id='fixture-user'`, [
      userId,
    ]);
    const archive = join(temporary, "fixture.dump");
    const exec = promisify(execFile);
    await exec("pg_dump", [
      "--format=custom",
      "--data-only",
      "--file",
      archive,
      ...[
        "users",
        "identity_bindings",
        "problems",
        "problem_versions",
        "problem_languages",
        "workspaces",
      ].flatMap((name) => ["--table", `public.${name}`]),
      ...["user", "account", "session", "passkey"].flatMap((name) => [
        "--table",
        `quorem_auth."${name}"`,
      ]),
      url!,
    ]);
    await pool.query(
      "DROP SCHEMA quorem_auth CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public",
    );
    await migrate(pool, "product", productDir);
    await migrate(pool, "auth", authDir);
    for (const [schema, names] of [
      [
        "public",
        [
          "users",
          "identity_bindings",
          "problems",
          "problem_versions",
          "problem_languages",
          "workspaces",
        ],
      ],
      ["quorem_auth", ["user", "account", "session", "passkey"]],
    ] as const)
      for (const name of names)
        await exec("pg_restore", [
          "--data-only",
          "--disable-triggers",
          "--exit-on-error",
          "--schema",
          schema,
          "--table",
          name,
          "--dbname",
          url!,
          archive,
        ]);
    await migrate(pool, "product", productDir);
    await migrate(pool, "auth", authDir);
    const restored = await pool.query(
      `SELECT w.owner_id,w.language,v.title,p.slug,b.subject FROM workspaces w JOIN problem_versions v ON v.id=w.problem_version_id JOIN problems p ON p.id=v.problem_id JOIN identity_bindings b ON b.user_id=w.owner_id WHERE w.id='30000000-0000-4000-8000-000000000003'`,
    );
    assert.deepEqual(restored.rows, [
      {
        owner_id: "fixture-user",
        language: "python",
        title: "Fixture",
        slug: "fixture-problem",
        subject: userId,
      },
    ]);
    assert.equal(
      (
        await pool.query(
          `SELECT 1 FROM quorem_auth."user" u JOIN quorem_auth.account a ON a."userId"=u.id JOIN quorem_auth.session s ON s."userId"=u.id JOIN quorem_auth.passkey p ON p."userId"=u.id WHERE u.id=$1 AND p.counter=4294967295`,
          [userId],
        )
      ).rowCount,
      1,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
    await pool.end();
  }
});
