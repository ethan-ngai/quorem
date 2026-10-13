import { createHmac, randomUUID } from "node:crypto";
import { migrateAuth } from "./migrations";
import { describe, it, expect } from "vitest";
const databaseURL = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!databaseURL)("managed service with disposable PostgreSQL", () => {
  it("starts Cognito PKCE, mints verified application JWT, and revokes logout", async () => {
    Object.assign(process.env, {
      APP_ENV: "local",
      AUTH_ORIGIN: "http://127.0.0.1:5174",
      BETTER_AUTH_SECRET: "mock-secret-".repeat(4),
      AUTH_DATABASE_URL: databaseURL,
      AUTH_INTERNAL_SECRET: "mock-internal-secret",
      COGNITO_CLIENT_ID: "mock-client",
      COGNITO_CLIENT_SECRET: "mock-secret",
      COGNITO_DOMAIN: "mock.auth.us-east-1.amazoncognito.com",
      COGNITO_REGION: "us-east-1",
      COGNITO_USERPOOL_ID: "us-east-1_mock",
    });
    const { database, config } = await import("./database");
    await migrateAuth(database);
    const { auth } = await import("./auth");
    const id = randomUUID();
    const sessionId = randomUUID();
    const sessionToken = randomUUID();
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
      const signin = await call("sign-in/social", "POST", {
        provider: "cognito",
        callbackURL: `${config.origin}/practice`,
      });
      expect(signin.status).toBe(200);
      const redirect = new URL(((await signin.json()) as { url: string }).url);
      expect(redirect.hostname).toBe("mock.auth.us-east-1.amazoncognito.com");
      expect(redirect.searchParams.get("state")).toBeTruthy();
      expect(redirect.searchParams.get("code_challenge_method")).toBe("S256");
      await database.query(
        'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,NOW(),NOW())',
        [id, "Mock verified user", `${id}@example.test`],
      );
      await database.query(
        'INSERT INTO "session"(id,token,"userId","expiresAt","createdAt","updatedAt") VALUES($1,$2,$3,NOW()+interval \'1 hour\',NOW(),NOW())',
        [sessionId, sessionToken, id],
      );
      const signature = createHmac("sha256", config.secret).update(sessionToken).digest("base64");
      const cookie = `better-auth.session_token=${encodeURIComponent(`${sessionToken}.${signature}`)}`;
      const response = await call("token", "GET", undefined, cookie);
      expect(response.status).toBe(200);
      const token = ((await response.json()) as { token: string }).token;
      const payload = JSON.parse(
        Buffer.from(token.split(".")[1], "base64url").toString(),
      ) as Record<string, unknown>;
      expect(payload.sub).toBe(id);
      expect(payload.sessionId).toBe(sessionId);
      expect(payload.emailVerified).toBe(true);
      expect(payload.aud).toBe("quorem-api");
      expect(Number(payload.exp) - Number(payload.iat)).toBe(300);
      expect((await call("jwks")).status).toBe(200);
      expect((await call("sign-out", "POST", {}, cookie)).status).toBe(200);
      expect((await call("token", "GET", undefined, cookie)).status).toBe(401);
      expect(
        (await database.query('SELECT 1 FROM "session" WHERE id=$1', [sessionId])).rowCount,
      ).toBe(0);
      expect(
        (
          await call("sign-up/email", "POST", {
            email: "duplicate@example.test",
            password: "passwordpassword",
            name: "Nobody",
          })
        ).status,
      ).toBe(400);
    } finally {
      await database.query('DELETE FROM "user" WHERE id=$1', [id]);
      await database.end();
    }
  });
});
