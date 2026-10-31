import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
import { migrateAuth } from "./migrations.ts";
const databaseURL = "postgres://postgres:fixture-only@127.0.0.1:55450/quorem_hono_media_test";
const origin = "http://127.0.0.1:58751";
const pool = new pg.Pool({ connectionString: databaseURL });
const id = randomUUID(),
  sessionId = randomUUID(),
  token = randomUUID();
const cookie = `better-auth.session_token=${encodeURIComponent(`${token}.${createHmac("sha256", "mock-secret-".repeat(4)).update(token).digest("base64")}`)}`;
try {
  await migrateAuth(pool);
  await pool.query(
    "DELETE FROM quorem_auth.profile_mutation_lease; DELETE FROM quorem_auth.profile_mutation_window",
  );
  await pool.query(
    'INSERT INTO quorem_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,NOW(),NOW())',
    [id, "Media fixture", `${id}@example.test`],
  );
  await pool.query(
    'INSERT INTO quorem_auth."session"(id,token,"userId","expiresAt","createdAt","updatedAt") VALUES($1,$2,$3,NOW()+interval \'1 hour\',NOW(),NOW())',
    [sessionId, token, id],
  );
  const request = (path, opts = {}) =>
    fetch(origin + path, { ...opts, headers: { origin, cookie, ...opts.headers } });
  const image = await sharp({ create: { width: 40, height: 20, channels: 3, background: "red" } })
    .png()
    .toBuffer();
  if (process.argv.includes("--outage")) {
    const unavailable = await request("/api/auth/profile-photo", {
      method: "PUT",
      headers: { "content-type": "image/png" },
      body: image,
    });
    assert.equal(unavailable.status, 503);
    assert.equal(
      Number(
        (await pool.query("SELECT count(*) FROM quorem_auth.profile_mutation_lease")).rows[0].count,
      ),
      1,
    );
    console.log("PASS native workerd: unreachable executor returns 503 and retains lease");
  } else {
    const uploaded = await request("/api/auth/profile-photo", {
      method: "PUT",
      headers: { "content-type": "image/png" },
      body: image,
    });
    assert.equal(uploaded.status, 200, await uploaded.clone().text());
    const photo = (await uploaded.json()).image;
    const saved = await request(photo);
    assert.equal(saved.status, 200);
    assert.equal(saved.headers.get("content-type"), "image/webp");
    assert.equal((await sharp(Buffer.from(await saved.arrayBuffer())).metadata()).format, "webp");
    const profile = await request("/api/auth/profile");
    assert.equal((await profile.json()).id, id);
    const patch = await request("/api/auth/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: '{"color":3}',
    });
    assert.equal(patch.status, 200, await patch.text());
    const attempts = await Promise.all(
      [0, 1].map(() =>
        request("/api/auth/profile-photo", {
          method: "PUT",
          headers: { "content-type": "image/png" },
          body: image,
        }),
      ),
    );
    assert.deepEqual(attempts.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await request(photo)).status, 404);
    const current = (await (await request("/api/auth/profile")).json()).image;
    assert.equal((await request(current)).status, 200);
    assert.equal(
      (
        await request("/api/auth/profile-photo", {
          method: "PUT",
          headers: { "content-type": "image/jpeg" },
          body: image,
        })
      ).status,
      415,
    );
    const removed = await request("/api/auth/profile-photo", { method: "DELETE" });
    assert.equal(removed.status, 200, await removed.text());
    assert.equal((await request(current)).status, 404);
    await pool.query('DELETE FROM quorem_auth."session" WHERE id=$1', [sessionId]);
    assert.equal((await request("/api/auth/profile-photo", { method: "DELETE" })).status, 401);
    console.log(
      "PASS native workerd: R2, real isolated Sharp service, upload/read/delete, profile, revocation",
    );
  }
} finally {
  await pool.query('DELETE FROM quorem_auth."user" WHERE id=$1', [id]);
  await pool.end();
}
