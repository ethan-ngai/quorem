/** @file sudo-mail.test.ts @description Composed SMTP sudo fallback through durable mail and Better Auth. @module auth */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { migrateAuth } from "./migrations.ts";
const url = process.env.AUTH_TEST_DATABASE_URL;
const inbox = process.env.AUTH_TEST_MAILPIT_URL;
describe.skipIf(!url || !inbox)("sudo email delivery", () => {
  it("delivers a code and elevates only after verification", async () => {
    expect(new URL(url!).pathname).toBe("/quorem_hono_auth_native_test");
    const origin = "http://localhost:5180";
    const runtime = await (
      await import("./node-auth.ts")
    ).createNodeRuntime({
      APP_ENV: "local",
      AUTH_MODE: "password",
      AUTH_ORIGIN: origin,
      BETTER_AUTH_SECRET: "mock-secret-".repeat(4),
      AUTH_DATABASE_URL: url,
      AUTH_INTERNAL_SECRET: "fixture",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: process.env.AUTH_TEST_SMTP_PORT ?? "51025",
      AUTH_MAIL_INTENT_KEY: "04".repeat(32),
    });
    let userId = "";
    try {
      await migrateAuth(runtime.database);
      const email = `${randomUUID()}@example.test`,
        password = "Fixture-password1!";
      const signup = await runtime.createAuth(true).handler(
        new Request(`${origin}/api/auth/sign-up/email`, {
          method: "POST",
          headers: { Origin: origin, "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            name: "Sudo mail fixture",
            username: randomUUID().replaceAll("-", "").slice(0, 16),
          }),
        }),
      );
      expect(signup.status).toBe(200);
      userId = (await signup.json()).user.id;
      await runtime.database.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [userId]);
      const login = await runtime.auth.handler(
        new Request(`${origin}/api/auth/sign-in/email`, {
          method: "POST",
          headers: { Origin: origin, "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        }),
      );
      const cookie = login.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      const call = (path: string, body?: object) =>
        runtime.app.fetch(
          new Request(`${origin}/api/auth/sudo/${path}`, {
            method: body ? "POST" : "GET",
            headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" },
            body: body ? JSON.stringify(body) : undefined,
          }),
        );
      expect((await (await call("status")).json()).methods.email).toBe(true);
      expect((await call("send-code", {})).status).toBe(200);
      expect((await (await call("status")).json()).until).toBe(0);
      const messages = await (await fetch(`${inbox}/api/v1/messages?limit=500`)).json();
      const message = messages.messages.find((entry: { To: { Address: string }[] }) =>
        entry.To.some((to) => to.Address === email),
      );
      expect(message).toBeDefined();
      const delivered = await (await fetch(`${inbox}/api/v1/message/${message.ID}`)).json();
      expect(delivered.Subject).toBe("Confirm sudo mode");
      expect(delivered.Text).toContain("5 minutes");
      const code = String(delivered.Text).match(/\b\d{6}\b/)?.[0];
      expect(code).toBeDefined();
      expect((await call("email-code", { code })).status).toBe(200);
      expect((await (await call("status")).json()).until).toBeGreaterThan(Date.now() / 1000);
      expect((await call("email-code", { code })).status).toBe(400);
    } finally {
      if (userId) await runtime.database.query('DELETE FROM "user" WHERE id=$1', [userId]);
      await runtime.database.end();
    }
  });
});
