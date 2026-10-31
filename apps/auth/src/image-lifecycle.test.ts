import { describe, expect, it } from "vitest";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const token = "fixture-token-".repeat(3);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function children(parent: number): number[] {
  const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" });
  return rows
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter(([, ppid]) => ppid === parent)
    .map(([pid]) => pid);
}
function exists(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function until<T>(fn: () => T | undefined, timeout = 5000): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = fn();
    if (result !== undefined) return result;
    await pause(10);
  }
  throw new Error("Fixture deadline exceeded");
}
async function port() {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const value = (listener.address() as { port: number }).port;
  listener.close();
  await once(listener, "close");
  return value;
}
for (const signal of ["SIGKILL", "SIGTERM"] as const) {
  describe(`image service ${signal}`, () => {
    it("terminates a stopped active Sharp child after service exit", async () => {
      const listenerPort = await port();
      const service = spawn(
        process.execPath,
        [fileURLToPath(new URL("./image-service-main.ts", import.meta.url))],
        {
          env: { IMAGE_SERVICE_TOKEN: token, IMAGE_SERVICE_PORT: String(listenerPort) },
          stdio: "ignore",
        },
      );
      let sharpPid = 0,
        supervisorPid = 0;
      try {
        const url = `http://127.0.0.1:${listenerPort}/`;
        await until(() => {
          try {
            execFileSync("curl", ["--silent", "--max-time", "1", url], { stdio: "ignore" });
            return true;
          } catch {
            return undefined;
          }
        });
        const input = await sharp({
          create: { width: 4000, height: 4000, channels: 3, background: "red" },
        })
          .png()
          .toBuffer();
        const pending = fetch(url, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "x-image-format": "png" },
          body: input,
        }).catch(() => undefined);
        supervisorPid = await until(() => children(service.pid!)[0]);
        sharpPid = await until(() => children(supervisorPid)[0]);
        process.kill(sharpPid, "SIGSTOP");
        expect(exists(sharpPid)).toBe(true);
        service.kill(signal);
        await until(() => (!exists(sharpPid) ? true : undefined));
        await until(() => (!exists(supervisorPid) ? true : undefined));
        await pending;
      } finally {
        if (sharpPid && exists(sharpPid)) {
          process.kill(sharpPid, "SIGCONT");
          process.kill(sharpPid, "SIGKILL");
        }
        if (supervisorPid && exists(supervisorPid)) process.kill(supervisorPid, "SIGKILL");
        service.kill("SIGKILL");
      }
    }, 15000);
  });
}

describe("image supervisor loss", () => {
  it("withholds termination proof when the supervisor dies before its child", async () => {
    const listenerPort = await port();
    const service = spawn(
      process.execPath,
      [fileURLToPath(new URL("./image-service-main.ts", import.meta.url))],
      {
        env: { IMAGE_SERVICE_TOKEN: token, IMAGE_SERVICE_PORT: String(listenerPort) },
        stdio: "ignore",
      },
    );
    let sharpPid = 0,
      supervisorPid = 0;
    try {
      const url = `http://127.0.0.1:${listenerPort}/`;
      await until(() => {
        try {
          execFileSync("curl", ["--silent", "--max-time", "1", url], { stdio: "ignore" });
          return true;
        } catch {
          return undefined;
        }
      });
      const input = await sharp({
        create: { width: 4000, height: 4000, channels: 3, background: "red" },
      })
        .png()
        .toBuffer();
      const pending = fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "x-image-format": "png" },
        body: input,
      });
      supervisorPid = await until(() => children(service.pid!)[0]);
      sharpPid = await until(() => children(supervisorPid)[0]);
      process.kill(sharpPid, "SIGSTOP");
      process.kill(supervisorPid, "SIGKILL");
      const response = await pending;
      expect(response.status).toBe(503);
      expect(response.headers.get("x-image-execution")).toBeNull();
      expect(exists(sharpPid)).toBe(true);
      await response.body?.cancel();
    } finally {
      if (sharpPid && exists(sharpPid)) {
        process.kill(sharpPid, "SIGCONT");
        process.kill(sharpPid, "SIGKILL");
      }
      if (supervisorPid && exists(supervisorPid)) process.kill(supervisorPid, "SIGKILL");
      service.kill("SIGKILL");
    }
  }, 15000);
});
