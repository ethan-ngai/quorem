/** @file sudo.test.ts @description Real Better Auth reauthentication, session isolation and single-use email codes. @module auth */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { migrateAuth } from "./migrations.ts";
import { createSudoHandler } from "./sudo.ts";
const url = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!url)("sudo on disposable PostgreSQL", () => {
  it("verifies the current account, binds codes to sessions, expires and revokes authority", async () => {
    const parsed = new URL(url!);
    expect(parsed.pathname).toBe("/quorem_hono_auth_native_test");
    expect(["127.0.0.1", "localhost"]).toContain(parsed.hostname);
    const origin = "http://localhost:5174";
    const runtime = await (
      await import("./node-auth.ts")
    ).createNodeRuntime({
      APP_ENV: "local",
      AUTH_MODE: "password",
      AUTH_ORIGIN: origin,
      BETTER_AUTH_SECRET: "mock-secret-".repeat(4),
      AUTH_DATABASE_URL: url,
      AUTH_INTERNAL_SECRET: "fixture-internal",
    });
    let userId = "";
    let code = "";
    try {
      await migrateAuth(runtime.database);
      const email = `${randomUUID()}@example.test`;
      const password = "Sudo-fixture-password1!";
      const signup = await runtime.createAuth(true).handler(
        new Request(`${origin}/api/auth/sign-up/email`, {
          method: "POST",
          headers: { Origin: origin, "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Sudo fixture",
            username: randomUUID().replaceAll("-", "").slice(0, 16),
            email,
            password,
          }),
        }),
      );
      expect(signup.status).toBe(200);
      userId = (await signup.json()).user.id;
      await runtime.database.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [userId]);
      const login = async () => {
        const response = await runtime.auth.handler(
          new Request(`${origin}/api/auth/sign-in/email`, {
            method: "POST",
            headers: { Origin: origin, "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
          }),
        );
        expect(response.status).toBe(200);
        return response.headers
          .getSetCookie()
          .map((value) => value.split(";")[0])
          .join("; ");
      };
      const cookie = await login(),
        other = await login();
      const handler = createSudoHandler({
        auth: runtime.auth,
        repository: runtime.repository,
        origin,
        secret: runtime.config.secret,
        passkey: false,
        send: async (address, value) => {
          expect(address).toBe(email);
          code = value;
        },
      });
      const call = (path: string, body?: object, authCookie = cookie, source = origin) =>
        handler(
          new Request(`${origin}/api/auth/sudo/${path}`, {
            method: body ? "POST" : "GET",
            headers: {
              Cookie: authCookie,
              Origin: source,
              ...(body ? { "Content-Type": "application/json" } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
          }),
        );
      const status = async (authCookie = cookie) =>
        (await call("status", undefined, authCookie)).json();
      expect((await status()).methods).toEqual({ password: true, passkey: false, email: true });
      expect((await status()).until).toBe(0);
      const protectedCall = () =>
        runtime.auth.handler(
          new Request(`${origin}/api/auth/link-social`, {
            method: "POST",
            headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
            body: JSON.stringify({ provider: "github", callbackURL: origin }),
          }),
        );
      expect((await (await protectedCall()).json()).code).toBe("STEP_UP_REQUIRED");
      expect((await call("password", { password }, cookie, "https://evil.example")).status).toBe(
        403,
      );
      expect((await call("password", { password }, "")).status).toBe(401);
      expect((await call("password", { password: "wrong" })).status).toBe(400);
      expect((await status()).until).toBe(0);
      expect((await call("password", { password })).status).toBe(200);
      expect((await (await protectedCall()).json()).code).not.toBe("STEP_UP_REQUIRED");
      expect((await status()).until).toBeGreaterThan(Date.now() / 1000 + 890);
      expect((await status(other)).until).toBe(0);
      expect((await call("send-code", {})).status).toBe(200);
      expect(code).toMatch(/^\d{6}$/);
      expect((await call("send-code", {})).status).toBe(429);
      expect((await call("email-code", { code }, other)).status).toBe(400);
      expect(
        (await call("email-code", { code: code === "000000" ? "111111" : "000000" })).status,
      ).toBe(400);
      const attempts = await Promise.all([
        call("email-code", { code }),
        call("email-code", { code }),
      ]);
      expect(attempts.map((response) => response.status).sort((a, b) => a - b)).toEqual([200, 400]);
      expect((await call("email-code", { code })).status).toBe(400);
      const session = await runtime.auth.api.getSession({
        headers: new Headers({ Cookie: cookie }),
      });
      await runtime.database.query(
        "UPDATE session_assurance SET strong_at=clock_timestamp()-interval '16 minutes' WHERE session_id=$1",
        [session!.session.id],
      );
      expect((await status()).until).toBe(0);
      for (let attempt = 0; attempt < 4; attempt++) await call("password", { password: "wrong" });
      expect((await call("password", { password })).status).toBe(429);
      expect((await status()).until).toBe(0);
      // Non-password accounts receive only methods actually bound to their account.
      await runtime.database.query('DELETE FROM account WHERE "userId"=$1', [userId]);
      expect((await status()).methods.password).toBe(false);
      await runtime.auth.handler(
        new Request(`${origin}/api/auth/sign-out`, {
          method: "POST",
          headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
          body: "{}",
        }),
      );
      expect((await call("status")).status).toBe(401);
    } finally {
      if (userId) await runtime.database.query('DELETE FROM "user" WHERE id=$1', [userId]);
      await runtime.database.end();
    }
  });
});
