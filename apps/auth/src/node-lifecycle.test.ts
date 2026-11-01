import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { createNodeRuntime } from "./node-auth.ts";

describe("explicit Node composition", () => {
  it("imports all CLI modules without runtime environment or starting services", () => {
    const env = { ...process.env };
    for (const key of Object.keys(env))
      if (key.startsWith("AUTH_") || key === "BETTER_AUTH_SECRET") delete env[key];
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `await Promise.all([import('./src/server.ts'),import('./src/seed.ts'),import('./src/migrate.ts'),import('./src/bootstrap.ts'),import('./src/node-auth.ts'),import('./src/database.ts')])`,
      ],
      { cwd: process.cwd(), env, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
  });
  it.skipIf(!process.env.AUTH_TEST_DATABASE_URL)(
    "starts and closes the Node listener explicitly",
    async () => {
      const { startServer } = await import("./server.ts");
      const runtime = await startServer({
        APP_ENV: "local",
        AUTH_MODE: "password",
        AUTH_ORIGIN: "http://localhost:5180",
        AUTH_DATABASE_URL: process.env.AUTH_TEST_DATABASE_URL,
        AUTH_INTERNAL_SECRET: "fixture",
        BETTER_AUTH_SECRET: "fixture-secret-".repeat(4),
        AUTH_PORT: "0",
        AUTH_HOST: "127.0.0.1",
      });
      try {
        if (!runtime.server.listening) await once(runtime.server, "listening");
        const address = runtime.server.address();
        if (!address || typeof address === "string") throw new Error("Expected TCP listener");
        const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/quorem-config`);
        expect(response.status).toBe(200);
        expect((await response.json()).method).toBe("password");
        expect(
          (await fetch(`http://127.0.0.1:${address.port}/internal/session/example`)).status,
        ).toBe(401);
      } finally {
        await new Promise<void>((resolve, reject) =>
          runtime.server.close((error) => (error ? reject(error) : resolve())),
        );
        await runtime.database.end();
      }
    },
  );
  it("rejects missing mail key before a configured runtime is usable", async () => {
    await expect(
      createNodeRuntime({
        APP_ENV: "local",
        AUTH_MODE: "password",
        AUTH_ORIGIN: "http://localhost:5180",
        AUTH_DATABASE_URL: "postgres://localhost/fixture",
        AUTH_INTERNAL_SECRET: "fixture",
        BETTER_AUTH_SECRET: "fixture-secret-".repeat(4),
        SMTP_HOST: "127.0.0.1",
      }),
    ).rejects.toThrow("AUTH_MAIL_INTENT_KEY must be 32 bytes encoded as hex");
  });
});
