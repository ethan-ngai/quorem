import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fenceStageRuntime } from "./hono-stage-recovery-fence.mjs";
const { Client } = createRequire(new URL("../packages/database/package.json", import.meta.url))(
  "pg",
);
const url = process.env.QUOREM_STAGE_RECOVERY_TEST_DATABASE_URL;
if (url) {
  const u = new URL(url);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) ||
    u.port !== "55598" ||
    u.pathname !== "/quorem_hono_stage" ||
    [...u.searchParams.keys()].some((key) =>
      ["host", "hostaddr", "service"].includes(key.toLowerCase()),
    )
  )
    throw new Error("Isolated stage recovery database required");
}
void test(
  "native workerd loses borrowed connection and cannot reconnect after role fence",
  { skip: !url, timeout: 60000 },
  async () => {
    const admin = new Client({ connectionString: url });
    admin.on("error", () => {});
    await admin.connect();
    const suffix = randomBytes(8).toString("hex"),
      role = `quorem_stage_runtime_${suffix}`,
      password = randomBytes(24).toString("hex");
    const dir = await mkdtemp(join(tmpdir(), "quorem-recovery-workerd-"));
    let worker;
    try {
      await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'`);
      const runtimeUrl = new URL(url);
      runtimeUrl.username = role;
      runtimeUrl.password = password;
      const server = createServer();
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const port = server.address().port;
      await new Promise((done) => server.close(done));
      const config = join(dir, "wrangler.json");
      await writeFile(
        config,
        JSON.stringify({
          name: "quorem-recovery-role-test",
          main: resolve("apps/api/src/runtime/composition/fixtures/recovery-worker.ts"),
          compatibility_date: "2026-10-23",
          compatibility_flags: ["nodejs_compat"],
          hyperdrive: [{ binding: "DB", id: "a".repeat(32) }],
        }),
      );
      worker = spawn(
        "vp",
        [
          "-C",
          "apps/api",
          "exec",
          "wrangler",
          "dev",
          "--local",
          "--config",
          config,
          "--ip",
          "127.0.0.1",
          "--port",
          String(port),
        ],
        {
          env: {
            ...process.env,
            CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_DB: runtimeUrl.href,
            WRANGLER_SEND_METRICS: "false",
          },
          stdio: "ignore",
          detached: true,
        },
      );
      const origin = `http://127.0.0.1:${port}`;
      let ready = false;
      for (let i = 0; i < 120; i++) {
        try {
          if ((await fetch(origin)).status === 200) {
            ready = true;
            break;
          }
        } catch {}
        await delay(100);
      }
      assert.equal(ready, true);
      const pending = fetch(`${origin}/hold`);
      let active = false;
      for (let i = 0; i < 100; i++) {
        if (
          (
            await admin.query(
              "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename=$1 AND state='active' AND query LIKE '%pg_sleep%') AS active",
              [role],
            )
          ).rows[0].active
        ) {
          active = true;
          break;
        }
        await delay(50);
      }
      assert.equal(active, true);
      await fenceStageRuntime(admin, role);
      assert.equal((await pending).status, 503);
      assert.equal((await fetch(origin)).status, 503);
      assert.equal(
        (
          await admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename=$1", [
            role,
          ])
        ).rows[0].n,
        0,
      );
    } finally {
      if (worker?.pid) {
        try {
          process.kill(-worker.pid, "SIGTERM");
        } catch {}
        await Promise.race([once(worker, "exit").catch(() => {}), delay(5000)]);
      }
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
      await admin.end();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
