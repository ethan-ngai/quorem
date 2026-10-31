import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "@quorem/database/migrations";
import { test } from "node:test";
import pg from "pg";
import {
  cutoverDatabaseIdentity,
  profileObjectCutover,
  profileObjectEndpoint,
} from "./profile-object-cutover.ts";

void test("resume identity rejects routing overrides and requires verified remote TLS", () => {
  const a = cutoverDatabaseIdentity("postgres://user:secret@db.example/app?sslmode=verify-full");
  assert.deepEqual(
    a,
    cutoverDatabaseIdentity("postgres://other:secret2@db.example:5432/app?sslmode=verify-full"),
  );
  assert.notDeepEqual(
    a,
    cutoverDatabaseIdentity("postgres://db.example/other?sslmode=verify-full"),
  );
  assert.notDeepEqual(
    cutoverDatabaseIdentity("postgres://127.0.0.1/db?sslmode=disable"),
    cutoverDatabaseIdentity("postgres://127.0.0.1/db?sslmode=verify-full"),
  );
  assert.doesNotThrow(() => cutoverDatabaseIdentity("postgres://[::1]/db?sslmode=disable"));
  assert.equal(profileObjectEndpoint("http://[::1]:9000").origin, "http://[::1]:9000");
  assert.throws(() => profileObjectEndpoint("http://remote.example"));
  for (const value of [
    "postgres://db.example/app",
    "postgres://db.example/app?sslmode=require",
    "postgres://db.example/app?sslmode=verify-full&HOST=other",
    "postgres://db.example/app?sslmode=verify-full&hostaddr=127.0.0.1",
    "postgres://db.example/app?sslmode=verify-full&SERVICE=other",
    "postgres://db.example/app?sslmode=verify-full&SSLMODE=disable",
    "postgres://db.example/app?sslmode=verify-full#fragment",
    "https://db.example/app?sslmode=verify-full",
  ])
    assert.throws(() => cutoverDatabaseIdentity(value));
});

const url = process.env.QUOREM_PROFILE_CUTOVER_TEST_URL;
void test(
  "audited operator resumes bounded pages and never overwrites mismatched objects",
  { skip: !url },
  async () => {
    const parsed = new URL(url!);
    assert.equal(parsed.hostname, "127.0.0.1");
    assert.equal(parsed.port, "55707");
    assert.equal(parsed.pathname, "/quorem_hono_profile_cutover_test");
    assert.equal(parsed.search, "?sslmode=disable");
    assert.equal(parsed.hash, "");
    const pool = new pg.Pool({ connectionString: url });
    const lock = await pool.connect();
    const root = fileURLToPath(new URL("../../../../", import.meta.url));
    const operator = "00000000-0000-4000-8000-000000000001";
    const subject = "00000000-0000-4000-8000-000000000002";
    const first = "00000000-0000-4000-8000-000000000003";
    const second = "00000000-0000-4000-8000-000000000004";
    let locked = false;
    const objects = new Map<string, Buffer>(),
      writes: string[] = [];
    let racePath: string | undefined;
    const key1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      key2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    objects.set(`/source/avatars/${key1}.webp`, Buffer.from("first"));
    objects.set(`/source/avatars/${key2}.webp`, Buffer.from("second"));
    const server = createServer((req, res) => {
      const path = new URL(req.url!, "http://local").pathname;
      if (req.method === "GET") {
        const body = objects.get(path);
        if (!body) {
          res
            .writeHead(404, { "content-type": "application/xml" })
            .end("<Error><Code>NoSuchKey</Code></Error>");
          return;
        }
        res.writeHead(200, { "content-length": body.length }).end(body);
        return;
      }
      if (req.method === "PUT") {
        assert.equal(req.headers["if-none-match"], "*");
        if (path === racePath) {
          objects.set(path, Buffer.from("first"));
          racePath = undefined;
        }
        if (objects.has(path)) {
          res.writeHead(412).end();
          return;
        }
        const parts: Buffer[] = [];
        req.on("data", (part) => parts.push(Buffer.from(part)));
        req.on("end", () => {
          objects.set(path, Buffer.concat(parts));
          writes.push(path);
          res.writeHead(200).end();
        });
        return;
      }
      res.writeHead(405).end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const temp = await mkdtemp(join(tmpdir(), "profile-copy-test-"));
    const env = { ...process.env };
    try {
      assert.equal(
        (await lock.query("SELECT current_database() AS name")).rows[0].name,
        "quorem_hono_profile_cutover_test",
      );
      locked = (await lock.query("SELECT pg_try_advisory_lock(740038, 1) AS locked")).rows[0]
        .locked;
      assert.ok(locked, "fixture database is already in use");
      await lock.query(
        "DROP SCHEMA IF EXISTS quorem_auth CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public",
      );
      await migrate(pool, "product", resolve(root, "apps/api/migrations"));
      await migrate(pool, "auth", resolve(root, "apps/auth/migrations"));
      await pool.query(
        "INSERT INTO users(id,display_name,role) VALUES($1,'Fixture Operator','admin')",
        [operator],
      );
      await pool.query(
        `INSERT INTO quorem_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt",image) VALUES ($1,'Operator','operator@fixture.test',true,clock_timestamp(),clock_timestamp(),NULL),($2,'First','first@fixture.test',true,clock_timestamp(),clock_timestamp(),$4),($3,'Second','second@fixture.test',true,clock_timestamp(),clock_timestamp(),$5)`,
        [
          subject,
          first,
          second,
          `/api/auth/profile-photos/${key1}`,
          `/api/auth/profile-photos/${key2}`,
        ],
      );
      await pool.query(
        "INSERT INTO identity_bindings(issuer,subject,user_id) VALUES('https://auth.example',$1,$2)",
        [subject, operator],
      );
      await pool.query(
        "INSERT INTO access_audit(operation_id,actor,user_id,action,scope,reason) VALUES('bootstrap:operator',$1,$1,'operator.bootstrap',$2,'Disposable fixture')",
        [operator, subject],
      );
      Object.assign(process.env, {
        QUOREM_OPERATOR_DATABASE_URL: url,
        AUTH_ORIGIN: "https://auth.example",
        PROFILE_COPY_SOURCE_BUCKET: "source",
        PROFILE_COPY_DESTINATION_BUCKET: "destination",
        PROFILE_COPY_SOURCE_ENDPOINT: `http://127.0.0.1:${address.port}`,
        PROFILE_COPY_DESTINATION_ENDPOINT: `http://127.0.0.1:${address.port}`,
        PROFILE_COPY_SOURCE_ACCESS_KEY_ID: "local",
        PROFILE_COPY_SOURCE_SECRET_ACCESS_KEY: "local",
        PROFILE_COPY_DESTINATION_ACCESS_KEY_ID: "local",
        PROFILE_COPY_DESTINATION_SECRET_ACCESS_KEY: "local",
      });
      const audit = await profileObjectCutover([
        "--reason",
        "fixture",
        "--resume-file",
        join(temp, "audit.json"),
      ]);
      assert.equal(audit.missing, 2);
      assert.equal(audit.copied, 0);
      assert.equal(writes.length, 0);
      assert.equal(
        Number(
          (
            await pool.query(
              "SELECT count(*) FROM access_audit WHERE action='profile.objects.audit'",
            )
          ).rows[0].count,
        ),
        1,
      );
      await pool.query("UPDATE users SET disabled=true WHERE id=$1", [operator]);
      await assert.rejects(
        profileObjectCutover([
          "--apply",
          "--reason",
          "fixture",
          "--resume-file",
          join(temp, "denied.json"),
        ]),
        /operator/,
      );
      await pool.query("UPDATE users SET disabled=false WHERE id=$1", [operator]);
      await pool.query(`UPDATE quorem_auth."user" SET "emailVerified"=false WHERE id=$1`, [
        subject,
      ]);
      await assert.rejects(
        profileObjectCutover([
          "--apply",
          "--reason",
          "fixture",
          "--resume-file",
          join(temp, "unverified.json"),
        ]),
        /operator/,
      );
      await pool.query(`UPDATE quorem_auth."user" SET "emailVerified"=true WHERE id=$1`, [subject]);
      const file = join(temp, "resume.json"),
        args = [
          "--apply",
          "--reason",
          "fixture",
          "--resume-file",
          file,
          "--limit",
          "1",
          "--max-batches",
          "1",
        ];
      let result = await profileObjectCutover(args);
      assert.equal(result.complete, false);
      assert.equal((await stat(file)).mode & 0o777, 0o600);
      process.env.QUOREM_OPERATOR_DATABASE_URL = url!.replace(
        "sslmode=disable",
        "sslmode=verify-full",
      );
      await assert.rejects(profileObjectCutover(args), /resume/);
      process.env.QUOREM_OPERATOR_DATABASE_URL = url!;
      result = await profileObjectCutover(args);
      assert.equal(result.complete, false);
      result = await profileObjectCutover(args);
      assert.equal(result.complete, true);
      assert.equal(result.cutoverReady, false);
      assert.equal(writes.length, 2);
      assert.equal(objects.get(`/destination/avatars/${key1}.webp`)?.toString(), "first");
      assert.equal(objects.get(`/destination/avatars/${key2}.webp`)?.toString(), "second");
      assert.equal(objects.get(`/source/avatars/${key1}.webp`)?.toString(), "first");
      assert.equal(objects.get(`/source/avatars/${key2}.webp`)?.toString(), "second");
      const references = await pool.query(
        `SELECT image FROM quorem_auth."user" WHERE id IN ($1,$2) ORDER BY id`,
        [first, second],
      );
      assert.deepEqual(
        references.rows.map((row) => row.image),
        [`/api/auth/profile-photos/${key1}`, `/api/auth/profile-photos/${key2}`],
      );
      assert.ok((await readFile(file, "utf8")).includes('"complete":true'));
      assert.equal(
        Number(
          (
            await pool.query(
              "SELECT count(*) FROM access_audit WHERE action='profile.objects.copy'",
            )
          ).rows[0].count,
        ),
        3,
      );
      racePath = `/destination/avatars/${key1}.webp`;
      objects.delete(racePath);
      const raced = await profileObjectCutover([
        "--apply",
        "--reason",
        "fixture",
        "--resume-file",
        join(temp, "race.json"),
      ]);
      assert.equal(raced.missing, 1);
      assert.equal(raced.copied, 0);
      assert.equal(writes.length, 2);
      objects.set(`/destination/avatars/${key1}.webp`, Buffer.from("different"));
      await assert.rejects(
        profileObjectCutover([
          "--apply",
          "--reason",
          "fixture",
          "--resume-file",
          join(temp, "new.json"),
        ]),
        /mismatch/,
      );
      assert.equal(objects.get(`/destination/avatars/${key1}.webp`)?.toString(), "different");
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
      Object.assign(process.env, env);
      try {
        if (locked) {
          await lock.query(
            "DROP SCHEMA IF EXISTS quorem_auth CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public",
          );
          await lock.query("SELECT pg_advisory_unlock(740038, 1)");
        }
      } finally {
        lock.release();
        await pool.end();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(temp, { recursive: true, force: true });
    }
  },
);
