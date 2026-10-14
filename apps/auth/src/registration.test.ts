import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { migrateAuth } from "./migrations";
const databaseURL = process.env.AUTH_TEST_DATABASE_URL;
const inbox = process.env.AUTH_TEST_MAILPIT_URL;
describe.skipIf(!databaseURL || !inbox)("registration with disposable database and Mailpit", () => {
  it("sends a real SMTP link, requires verification before login and rejects forged tokens", async () => {
    Object.assign(process.env, {
      APP_ENV: "local",
      AUTH_MODE: "password",
      AUTH_ORIGIN: "http://localhost:5180",
      BETTER_AUTH_SECRET: "mock-secret-".repeat(4),
      AUTH_DATABASE_URL: databaseURL,
      AUTH_INTERNAL_SECRET: "mock-internal-secret",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "51025",
    });
    const { database, config } = await import("./database");
    await migrateAuth(database);
    const { auth } = await import("./auth");
    const username = `test${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const email = `${username}@example.test`,
      password = "a-real-test-password-long";
    const call = (path: string, body?: object, origin = config.origin) =>
      auth.handler(
        new Request(`${config.origin}/api/auth/${path}`, {
          method: body ? "POST" : "GET",
          headers: { Origin: origin, ...(body ? { "Content-Type": "application/json" } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      );
    let subject: string | undefined;
    try {
      const payload = {
        name: "New user",
        emailVerified: true,
        username,
        email,
        password,
        callbackURL: `${config.origin}/login?verified=1`,
      };
      expect((await call("sign-up/email", payload, "https://evil.example")).status).toBe(403);
      const signup = await call("sign-up/email", payload);
      expect(signup.status).toBe(200);
      const created = await signup.json();
      subject = created.user.id;
      expect(created.token).toBeNull();
      expect(created.user.emailVerified).toBe(false);
      expect((await call("sign-in/username", { username, password })).status).toBe(403);
      expect((await call("sign-in/email", { email, password })).status).toBe(403);
      const listing = await (await fetch(`${inbox}/api/v1/messages`)).json();
      const delivered = listing.messages.find((message: { To: { Address: string }[] }) =>
        message.To.some((to) => to.Address === email),
      );
      expect(delivered).toBeTruthy();
      const message = await (await fetch(`${inbox}/api/v1/message/${delivered.ID}`)).json();
      const link = String(message.Text).match(
        /http:\/\/localhost:5180\/api\/auth\/verify-email\?[^\s]+/,
      )?.[0];
      expect(link).toBeTruthy();
      const forged = new URL(link!);
      forged.searchParams.set("token", "forged-token");
      const badVerification = await auth.handler(new Request(forged));
      expect(badVerification.status).toBe(302);
      expect(badVerification.headers.get("location")).toContain("error=");
      expect(
        (await database.query('SELECT "emailVerified" FROM "user" WHERE id=$1', [subject])).rows[0]
          .emailVerified,
      ).toBe(false);
      const verified = await auth.handler(new Request(link!));
      expect(verified.status).toBe(302);
      expect(verified.headers.get("location")).toBe(`${config.origin}/login?verified=1`);
      expect(
        (await database.query('SELECT "emailVerified" FROM "user" WHERE id=$1', [subject])).rows[0]
          .emailVerified,
      ).toBe(true);
      const signin = await call("sign-in/username", { username, password });
      expect(signin.status).toBe(200);
      const cookie = signin.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      const update = await auth.handler(
        new Request(`${config.origin}/api/auth/update-user`, {
          method: "POST",
          headers: { Origin: config.origin, Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ emailVerified: false }),
        }),
      );
      expect(update.status).toBe(400);
      expect(
        (await database.query('SELECT "emailVerified" FROM "user" WHERE id=$1', [subject])).rows[0]
          .emailVerified,
      ).toBe(true);
      const tokenResponse = await auth.handler(
        new Request(`${config.origin}/api/auth/token`, { headers: { Cookie: cookie } }),
      );
      expect(tokenResponse.status).toBe(200);
      const token = (await tokenResponse.json()).token;
      expect(
        JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).emailVerified,
      ).toBe(true);
    } finally {
      if (subject) await database.query('DELETE FROM "user" WHERE id=$1', [subject]);
      await database.end();
    }
  });
});
