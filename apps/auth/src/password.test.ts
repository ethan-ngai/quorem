import { Pool } from "pg";
import { migrateAuth } from "./migrations";
import { describe, it, expect } from "vitest";
const databaseURL = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!databaseURL)("local credential service with disposable PostgreSQL", () => {
  it("hashes seeded passwords, signs in by username, refuses signup and revokes logout", async () => {
    Object.assign(process.env, {
      APP_ENV: "local",
      AUTH_MODE: "password",
      AUTH_ORIGIN: "http://127.0.0.1:5174",
      BETTER_AUTH_SECRET: "mock-secret-".repeat(4),
      AUTH_DATABASE_URL: databaseURL,
      AUTH_INTERNAL_SECRET: "mock-internal-secret",
    });
    const runtime = await (await import("./node-auth")).createNodeRuntime(process.env);
    const { database, config, auth } = runtime;
    await migrateAuth(database);
    const { seedAccounts } = await import("./seed-accounts");
    const productURL = process.env.PRODUCT_AUTH_TEST_DATABASE_URL;
    const product = productURL ? new Pool({ connectionString: productURL }) : undefined;
    let seededSubjects: string[] = [];
    const password = "integration-password-long";
    const call = (path: string, method = "GET", body?: object, cookie?: string) =>
      auth.handler(
        new Request(`${config.origin}/api/auth/${path}`, {
          method,
          headers: {
            Origin: config.origin,
            ...(body ? { "Content-Type": "application/json" } : {}),
            ...(cookie ? { Cookie: cookie } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      );
    try {
      await database.query('DELETE FROM "user" WHERE username=ANY($1)', [["alice", "bob"]]);
      const accounts = await seedAccounts(runtime, password, productURL);
      seededSubjects = accounts.map((account) => account.subject);
      if (product) {
        const bindings = await product.query(
          "SELECT u.role,u.id,b.subject FROM identity_bindings b JOIN users u ON u.id=b.user_id WHERE b.issuer=$1 AND b.subject=ANY($2) ORDER BY u.role",
          [config.origin, seededSubjects],
        );
        expect(bindings.rows.map((row) => row.role)).toEqual(["admin", "user"]);
        expect(bindings.rows.every((row) => !["alice", "bob"].includes(row.id))).toBe(true);
      }
      expect(accounts.map((account) => account.username)).toEqual(["alice", "bob"]);
      expect(await seedAccounts(runtime, password, productURL)).toEqual(accounts);
      const stored = await database.query(
        'SELECT password FROM account WHERE "userId"=$1 AND "providerId"=\'credential\'',
        [accounts[0].subject],
      );
      expect(stored.rows[0].password).toBeTruthy();
      expect(stored.rows[0].password).not.toBe(password);
      expect(
        (
          await call("sign-in/username", "POST", {
            username: "alice",
            password: "wrong-password-long",
          })
        ).status,
      ).toBe(401);
      const signin = await call("sign-in/username", "POST", { username: "Alice", password });
      expect(signin.status).toBe(200);
      const cookie = signin.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      const tokenResponse = await call("token", "GET", undefined, cookie);
      expect(tokenResponse.status).toBe(200);
      const token = ((await tokenResponse.json()) as { token: string }).token;
      const payload = JSON.parse(
        Buffer.from(token.split(".")[1], "base64url").toString(),
      ) as Record<string, unknown>;
      expect(payload.sub).toBe(accounts[0].subject);
      expect(payload.emailVerified).toBe(true);
      expect(payload.aud).toBe("quorem-api");
      expect(
        (
          await call("sign-up/email", "POST", {
            email: "public@example.test",
            password,
            name: "Public",
            username: "public",
          })
        ).status,
      ).toBe(400);
      expect((await call("sign-out", "POST", {}, cookie)).status).toBe(200);
      expect((await call("token", "GET", undefined, cookie)).status).toBe(401);
      expect(
        (await database.query('SELECT 1 FROM "session" WHERE id=$1', [payload.sessionId])).rowCount,
      ).toBe(0);
    } finally {
      if (product) {
        const bindings = await product.query(
          "DELETE FROM identity_bindings WHERE issuer=$1 AND subject=ANY($2) RETURNING user_id",
          [config.origin, seededSubjects],
        );
        await product.query("DELETE FROM users WHERE id=ANY($1)", [
          bindings.rows.map((row) => row.user_id),
        ]);
        await product.end();
      }
      await database.query('DELETE FROM "user" WHERE username=ANY($1)', [["alice", "bob"]]);
      await database.end();
    }
  });
});
