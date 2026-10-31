import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { test } from "node:test";

const docker = (...args) =>
  execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const sharp = createRequire(new URL("../../../apps/auth/package.json", import.meta.url))("sharp");

test("private image container authenticates health and returns terminated Sharp output", async () => {
  const token = randomBytes(32).toString("hex");
  const id = docker(
    "run",
    "-d",
    "--rm",
    "-p",
    "127.0.0.1::8083",
    "-e",
    "IMAGE_SERVICE_TRANSPORT=cloudflare-container",
    "-e",
    "IMAGE_SERVICE_HOST=0.0.0.0",
    "-e",
    "IMAGE_SERVICE_PORT=8083",
    "-e",
    `IMAGE_SERVICE_TOKEN=${token}`,
    "quorem-35f-image-fixture:local",
  );
  try {
    const address = docker("port", id, "8083/tcp");
    const origin = `http://127.0.0.1:${address.split(":").at(-1)}`;
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      try {
        ready = (await fetch(`${origin}/health`, { headers: { authorization: `Bearer ${token}` } }))
          .ok;
      } catch {}
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(ready, true);
    assert.equal((await fetch(`${origin}/health`)).status, 401);
    const png = await sharp({
      create: { width: 40, height: 40, channels: 3, background: "#224466" },
    })
      .png()
      .toBuffer();
    const response = await fetch(origin, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "x-image-format": "png" },
      body: png,
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-image-execution"), "terminated");
    assert.equal(
      (await sharp(Buffer.from(await response.arrayBuffer())).metadata()).format,
      "webp",
    );
  } finally {
    docker("stop", "--time", "5", id);
  }
});
