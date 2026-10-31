import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import pg from "pg";
import { profileObjectCutover } from "./profile-object-cutover.ts";

const url = process.env.QUOREM_PROFILE_CUTOVER_TEST_URL;
test(
  "audited operator resumes bounded pages and never overwrites mismatched objects",
  { skip: !url },
  async () => {
    const parsed = new URL(url!);
    assert.equal(parsed.hostname, "127.0.0.1");
    assert.equal(parsed.port, "55707");
    assert.equal(parsed.pathname, "/quorem_hono_profile_cutover_test");
    assert.equal(parsed.search, "");
    assert.equal(parsed.hash, "");
    const pool = new pg.Pool({ connectionString: url });
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
      await pool.query(
        `CREATE SCHEMA quorem_auth; CREATE TABLE quorem_auth."user" (id text primary key, image text, "emailVerified" boolean); CREATE TABLE users(id text primary key, role text, disabled boolean); CREATE TABLE identity_bindings(user_id text, subject text, issuer text); CREATE TABLE access_audit(operation_id text primary key, actor text, user_id text, action text, scope text, reason text); INSERT INTO quorem_auth."user" VALUES ('subject',NULL,true), ('u1','/api/auth/profile-photos/${key1}',true), ('u2','/api/auth/profile-photos/${key2}',true); INSERT INTO users VALUES ('operator','admin',false); INSERT INTO identity_bindings VALUES ('operator','subject','https://auth.example'); INSERT INTO access_audit VALUES ('bootstrap:operator','operator','operator','operator.bootstrap','subject','fixture');`,
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
      await pool.query("UPDATE users SET disabled=true WHERE id='operator'");
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
      await pool.query("UPDATE users SET disabled=false WHERE id='operator'");
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
      result = await profileObjectCutover(args);
      assert.equal(result.complete, false);
      result = await profileObjectCutover(args);
      assert.equal(result.complete, true);
      assert.equal(result.cutoverReady, false);
      assert.equal(writes.length, 2);
      assert.equal(objects.get(`/destination/avatars/${key1}.webp`)?.toString(), "first");
      assert.equal(objects.get(`/destination/avatars/${key2}.webp`)?.toString(), "second");
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
      await pool.query(
        "DROP SCHEMA quorem_auth CASCADE; DROP TABLE access_audit, identity_bindings, users",
      );
      await pool.end();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(temp, { recursive: true, force: true });
    }
  },
);
