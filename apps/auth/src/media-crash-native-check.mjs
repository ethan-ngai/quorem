import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import sharp from "sharp";
const pool = new pg.Pool({
  connectionString: "postgres://postgres:fixture-only@127.0.0.1:55450/quorem_hono_media_test",
});
const id = randomUUID(),
  sid = randomUUID(),
  token = randomUUID();
const cookie = `better-auth.session_token=${encodeURIComponent(`${token}.${createHmac("sha256", "mock-secret-".repeat(4)).update(token).digest("base64")}`)}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const children = (parent) =>
  execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" })
    .trim()
    .split("\n")
    .map((row) => row.trim().split(/\s+/).map(Number))
    .filter(([, ppid]) => ppid === parent)
    .map(([pid]) => pid);
const exists = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const until = async (fn) => {
  for (let i = 0; i < 500; i++) {
    const result = fn();
    if (result) return result;
    await wait(10);
  }
  throw new Error("fixture timeout");
};
let supervisor = 0,
  child = 0;
const service = spawn(
  process.execPath,
  [fileURLToPath(new URL("./image-service-main.ts", import.meta.url))],
  {
    env: { IMAGE_SERVICE_TOKEN: "fixture-token-".repeat(3), IMAGE_SERVICE_PORT: "58752" },
    stdio: "ignore",
  },
);
try {
  await pool.query(
    "DELETE FROM quorem_auth.profile_mutation_lease; DELETE FROM quorem_auth.profile_mutation_window",
  );
  await pool.query(
    'INSERT INTO quorem_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,NOW(),NOW())',
    [id, "Fixture", `${id}@example.test`],
  );
  await pool.query(
    'INSERT INTO quorem_auth."session"(id,token,"userId","expiresAt","createdAt","updatedAt") VALUES($1,$2,$3,NOW()+interval \'1 hour\',NOW(),NOW())',
    [sid, token, id],
  );
  await until(() => {
    try {
      execFileSync("curl", ["--silent", "--max-time", "1", "http://127.0.0.1:58752/"], {
        stdio: "ignore",
      });
      return true;
    } catch {
      return false;
    }
  });
  const input = await sharp({
    create: { width: 4000, height: 4000, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const request = fetch("http://127.0.0.1:58751/api/auth/profile-photo", {
    method: "PUT",
    headers: { cookie, origin: "http://127.0.0.1:58751", "content-type": "image/png" },
    body: input,
  });
  supervisor = await until(() => children(service.pid)[0]);
  child = await until(() => children(supervisor)[0]);
  process.kill(child, "SIGSTOP");
  service.kill("SIGKILL");
  const result = await request;
  assert.equal(result.status, 503);
  await until(() => !exists(child));
  await until(() => !exists(supervisor));
  assert.equal(
    Number(
      (await pool.query("SELECT count(*) FROM quorem_auth.profile_mutation_lease")).rows[0].count,
    ),
    1,
  );
  console.log("PASS native workerd: service SIGKILL reaped active child and retained lease");
} finally {
  if (child && exists(child)) {
    process.kill(child, "SIGCONT");
    process.kill(child, "SIGKILL");
  }
  if (supervisor && exists(supervisor)) process.kill(supervisor, "SIGKILL");
  service.kill("SIGKILL");
  await pool.query('DELETE FROM quorem_auth."user" WHERE id=$1', [id]);
  await pool.end();
}
