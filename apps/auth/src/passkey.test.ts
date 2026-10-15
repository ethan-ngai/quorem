import { createHmac, randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { migrateAuth } from "./migrations";
const databaseURL = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!databaseURL)("passkey protocol with disposable PostgreSQL", () => {
  it("requires authenticated enrollment, exact origin, ownership and valid assertions", async () => {
    Object.assign(process.env, {
      APP_ENV: "local",
      AUTH_MODE: "password",
      AUTH_ORIGIN: "http://localhost:5174",
      BETTER_AUTH_SECRET: "mock-secret-".repeat(4),
      AUTH_DATABASE_URL: databaseURL,
      AUTH_INTERNAL_SECRET: "mock-internal-secret",
      GOOGLE_CLIENT_ID: "test-google-client",
      GOOGLE_CLIENT_SECRET: "test-google-secret",
    });
    const { database, config } = await import("./database");
    await migrateAuth(database);
    const { auth } = await import("./auth");
    const id = randomUUID(),
      other = randomUUID(),
      key = randomUUID(),
      sessionToken = randomUUID();
    const signature = createHmac("sha256", config.secret).update(sessionToken).digest("base64");
    const cookie = `better-auth.session_token=${encodeURIComponent(`${sessionToken}.${signature}`)}`;
    const call = (
      path: string,
      method = "GET",
      body?: object,
      session?: string,
      origin = config.origin,
    ) =>
      auth.handler(
        new Request(`${config.origin}/api/auth/${path}`, {
          method,
          headers: {
            Origin: origin,
            ...(body ? { "Content-Type": "application/json" } : {}),
            ...(session ? { Cookie: session } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      );
    try {
      for (const user of [id, other])
        await database.query(
          'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,NOW(),NOW())',
          [user, "Passkey user", `${user}@example.test`],
        );
      await database.query(
        'INSERT INTO "session"(id,token,"userId","expiresAt","createdAt","updatedAt") VALUES($1,$2,$3,NOW()+interval \'1 hour\',NOW(),NOW())',
        [randomUUID(), sessionToken, id],
      );
      expect((await call("passkey/generate-register-options")).status).toBe(401);
      const options = await call("passkey/generate-register-options", "GET", undefined, cookie);
      expect(options.status).toBe(200);
      const registration = await options.json();
      expect(registration.rp).toEqual({ name: "Quorem", id: "localhost" });
      expect(registration.challenge).toBeTruthy();
      expect((await call("passkey/generate-authenticate-options")).status).toBe(200);
      expect(
        (await call("passkey/verify-authentication", "POST", { response: {} })).status,
      ).toBeGreaterThanOrEqual(400);
      await database.query(
        'INSERT INTO passkey(id,name,"publicKey","userId","credentialID",counter,"deviceType","backedUp") VALUES($1,$2,$3,$4,$5,0,\'singleDevice\',false)',
        [key, "Foreign key", "not-a-real-public-key", other, randomUUID()],
      );
      expect(
        await (await call("passkey/list-user-passkeys", "GET", undefined, cookie)).json(),
      ).toEqual([]);
      expect(
        (await call("passkey/delete-passkey", "POST", { id: key }, cookie)).status,
      ).toBeGreaterThanOrEqual(400);
      expect((await database.query("SELECT id FROM passkey WHERE id=$1", [key])).rowCount).toBe(1);
      await database.query('UPDATE passkey SET "userId"=$1 WHERE id=$2', [id, key]);
      expect(
        (await (await call("passkey/list-user-passkeys", "GET", undefined, cookie)).json())[0].id,
      ).toBe(key);
      expect(
        (await call("passkey/delete-passkey", "POST", { id: key }, cookie, "https://evil.example"))
          .status,
      ).toBe(403);
      expect((await call("passkey/delete-passkey", "POST", { id: key }, cookie)).status).toBe(200);
      const social = await call("sign-in/social", "POST", {
        provider: "google",
        callbackURL: `${config.origin}/practice`,
      });
      expect(social.status).toBe(200);
      expect(new URL((await social.json()).url).hostname).toBe("accounts.google.com");
      expect(
        (
          await call("sign-in/social", "POST", {
            provider: "apple",
            callbackURL: `${config.origin}/practice`,
          })
        ).status,
      ).toBeGreaterThanOrEqual(400);
    } finally {
      await database.query('DELETE FROM "user" WHERE id=ANY($1)', [[id, other]]);
      await database.end();
    }
  });
});
