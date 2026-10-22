import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { migrateAuth } from "./migrations";
import { createRegistrationHandler } from "./registration";
import { verificationMailer } from "./mailer";
import { smtpEmail } from "./adapters/smtp-email";

const databaseURL = process.env.AUTH_TEST_DATABASE_URL;
async function clearLimits(database: Pool, email: string) {
  const keys = [
    ["registration:requests", "global"],
    ["email:registration:cooldown", email],
    ["email:registration:hour", email],
    ["email:registration:global", "global"],
  ].map((key) => createHash("sha256").update(JSON.stringify(key)).digest("hex"));
  await database.query("DELETE FROM rate_limit WHERE bucket=ANY($1)", [keys]);
}
describe.skipIf(!databaseURL)("email-first registration with disposable PostgreSQL", () => {
  it("requires email proof before credentials, limits sends, consumes proofs and preserves verified accounts", async () => {
    const database = new Pool({
      connectionString: databaseURL,
      options: "-c search_path=quorem_auth",
    });
    await migrateAuth(database);
    Object.assign(process.env, {
      APP_ENV: "local",
      AUTH_MODE: "password",
      AUTH_ORIGIN: "http://localhost:5180",
      BETTER_AUTH_SECRET: "mock-secret-".repeat(4),
      AUTH_DATABASE_URL: databaseURL,
      AUTH_INTERNAL_SECRET: "mock-internal-secret",
      SMTP_HOST: "127.0.0.1",
    });
    const { auth, database: authDatabase } = await import("./auth");
    const origin = "http://localhost:5180",
      name = `mail${randomUUID().replaceAll("-", "").slice(0, 16)}`,
      email = `${name}@example.test`,
      password = "Abc1234!";
    const messages: string[] = [];
    const smtp = process.env.AUTH_TEST_MAILPIT_URL
      ? verificationMailer(
          smtpEmail({
            host: "127.0.0.1",
            port: 51025,
            from: "Quorem <accounts@quorem.local>",
          }),
        )
      : undefined;
    const handler = createRegistrationHandler({
      database,
      origin,
      send: async (to, url) => {
        await smtp?.(to, url);
        messages.push(url);
      },
    });
    const call = async (path: string, body?: object, cookie = "", source = origin) =>
      (await handler(
        new Request(`${origin}/api/auth/registration/${path}`, {
          method: body ? "POST" : "GET",
          headers: {
            Origin: source,
            Cookie: cookie,
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(path === "complete" ? { ...body, email } : body) : undefined,
        }),
      ))!;
    try {
      await clearLimits(database, email);
      expect((await call("start", { email }, "", "https://evil.example")).status).toBe(403);
      expect((await call("complete", { username: name, password })).status).toBe(401);
      expect((await call("start", { email })).status).toBe(200);
      expect((await database.query('SELECT 1 FROM "user" WHERE email=$1', [email])).rowCount).toBe(
        0,
      );
      await Promise.all(Array.from({ length: 5 }, () => call("start", { email })));
      expect(messages).toHaveLength(1);
      const token = new URL(messages[0]).searchParams.get("signupToken");
      expect((await call("verify", { token: "x".repeat(43) })).status).toBe(400);
      const verified = await call("verify", { token });
      expect(verified.status).toBe(200);
      const cookie = verified.headers.get("set-cookie")!.split(";")[0];
      expect(verified.headers.get("set-cookie")).toContain("HttpOnly");
      expect((await call("status", undefined, cookie)).status).toBe(200);
      expect((await call("verify", { token })).status).toBe(400);
      // A username conflict must roll back without burning the verified setup capability.
      const reserved = randomUUID();
      await database.query(
        'INSERT INTO "user"(id,name,email,username,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,$2,true,NOW(),NOW())',
        [reserved, name, `reserved-${email}`],
      );
      expect((await call("complete", { username: name, password }, cookie)).status).toBe(409);
      await database.query('DELETE FROM "user" WHERE id=$1', [reserved]);
      const results = await Promise.all([
        call("complete", { username: name, password }, cookie),
        call("complete", { username: name, password }, cookie),
      ]);
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 401]);
      const user = (
        await database.query('SELECT id,name,"emailVerified" FROM "user" WHERE email=$1', [email])
      ).rows[0];
      expect(user.emailVerified).toBe(true);
      expect(user.name).toBe("");
      const stored = (
        await database.query('SELECT password FROM account WHERE "userId"=$1', [user.id])
      ).rows[0].password;
      expect(stored).not.toBe(password);
      const signIn = await auth.handler(
        new Request(`${origin}/api/auth/sign-in/username`, {
          method: "POST",
          headers: { Origin: origin, "Content-Type": "application/json" },
          body: JSON.stringify({ username: name, password }),
        }),
      );
      expect(signIn.status).toBe(200);
      const bypass = await auth.handler(
        new Request(`${origin}/api/auth/sign-up/email`, {
          method: "POST",
          headers: { Origin: origin, "Content-Type": "application/json" },
          body: JSON.stringify({
            email: `bypass-${email}`,
            username: `bypass${name}`,
            name,
            password,
          }),
        }),
      );
      expect(bypass.status).toBe(403);
      await clearLimits(database, email);
      await call("start", { email });
      const ownerProof = await call("verify", {
        token: new URL(messages[1]).searchParams.get("signupToken"),
      });
      const ownerCookie = ownerProof.headers.get("set-cookie")!.split(";")[0];
      expect((await (await call("status", undefined, ownerCookie)).json()).registered).toBe(true);
      expect(
        (
          await call(
            "complete",
            { username: name, password: "replacement-password-long" },
            ownerCookie,
          )
        ).status,
      ).toBe(409);
      expect(
        (await database.query('SELECT password FROM account WHERE "userId"=$1', [user.id])).rows[0]
          .password,
      ).toBe(stored);
      if (smtp) {
        const inbox = await (
          await fetch(`${process.env.AUTH_TEST_MAILPIT_URL}/api/v1/messages`)
        ).json();
        expect(
          inbox.messages.some((m: { To: { Address: string }[] }) =>
            m.To.some((t) => t.Address === email),
          ),
        ).toBe(true);
      }
    } finally {
      await database.query('DELETE FROM "user" WHERE email=$1 OR email=$2 OR email=$3', [
        email,
        `reserved-${email}`,
        `bypass-${email}`,
      ]);
      await database.query("DELETE FROM registration_email WHERE email=$1", [email]);
      await database.end();
      await authDatabase.end();
    }
  });

  it("recovers abandoned accounts only after proof, rejects expired grants and retries failed delivery", async () => {
    const database = new Pool({
      connectionString: databaseURL,
      options: "-c search_path=quorem_auth",
    });
    await migrateAuth(database);
    const name = `pending${randomUUID().replaceAll("-", "").slice(0, 12)}`,
      email = `${name}@example.test`,
      origin = "http://localhost:5180",
      id = randomUUID();
    let fail = true;
    const messages: string[] = [];
    const handler = createRegistrationHandler({
      database,
      origin,
      send: async (_email, url) => {
        if (fail) throw Error("SMTP down");
        messages.push(url);
      },
    });
    const call = async (path: string, body: object, cookie = "") =>
      (await handler(
        new Request(`${origin}/api/auth/registration/${path}`, {
          method: "POST",
          headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify(path === "complete" ? { ...body, email } : body),
        }),
      ))!;
    try {
      await clearLimits(database, email);
      await database.query(
        'INSERT INTO "user"(id,name,email,username,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,$2,false,NOW(),NOW())',
        [id, name, email],
      );
      expect((await call("start", { email })).status).toBe(503);
      fail = false;
      expect((await call("start", { email })).status).toBe(200);
      await database.query(
        "UPDATE registration_email SET expires_at=NOW()-interval '1 second' WHERE email=$1",
        [email],
      );
      expect(
        (await call("verify", { token: new URL(messages[0]).searchParams.get("signupToken") }))
          .status,
      ).toBe(400);
      await clearLimits(database, email);
      await call("start", { email });
      const proof = await call("verify", {
        token: new URL(messages[1]).searchParams.get("signupToken"),
      });
      const cookie = proof.headers.get("set-cookie")!.split(";")[0];
      expect(
        (
          await call(
            "complete",
            { username: name, password: "fresh-owner-password-123", name: "Test Person" },
            cookie,
          )
        ).status,
      ).toBe(200);
      expect(
        (await database.query('SELECT "emailVerified" FROM "user" WHERE id=$1', [id])).rows[0]
          .emailVerified,
      ).toBe(true);
      expect((await database.query('SELECT name FROM "user" WHERE id=$1', [id])).rows[0].name).toBe(
        "Test Person",
      );
    } finally {
      await database.query('DELETE FROM "user" WHERE id=$1', [id]);
      await database.query("DELETE FROM registration_email WHERE email=$1", [email]);
      await database.end();
    }
  });
  it("enforces five sends per address per hour across handler instances", async () => {
    const database = new Pool({
      connectionString: databaseURL,
      options: "-c search_path=quorem_auth",
    });
    await migrateAuth(database);
    const email = `quota-${randomUUID()}@example.test`,
      origin = "http://localhost:5180";
    let sent = 0;
    const request = () =>
      new Request(`${origin}/api/auth/registration/start`, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    const cooldownKey = createHash("sha256")
      .update(JSON.stringify(["email:registration:cooldown", email]))
      .digest("hex");
    try {
      await clearLimits(database, email);
      for (let attempt = 0; attempt < 6; attempt++) {
        await database.query("DELETE FROM rate_limit WHERE bucket=$1", [cooldownKey]);
        const handler = createRegistrationHandler({
          database,
          origin,
          send: async () => {
            sent++;
          },
        });
        const response = (await handler(request()))!;
        expect(response.status).toBe(200);
        const result = await response.json();
        if (attempt === 5) expect(result.retryAfter).toBeGreaterThan(60);
      }
      expect(sent).toBe(5);
    } finally {
      await database.query("DELETE FROM registration_email WHERE email=$1", [email]);
      await database.end();
    }
  });
});
