import { randomUUID } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import { migrateAuth } from "./migrations";
const databaseURL = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!databaseURL)("social identity with disposable PostgreSQL", () => {
  it("requires explicit linking, verifies missing email, preserves ownership and adds a first password", async () => {
    const origin = "http://localhost:5180";
    Object.assign(process.env, {
      APP_ENV: "local",
      AUTH_MODE: "password",
      AUTH_ORIGIN: origin,
      AUTH_DATABASE_URL: databaseURL,
      BETTER_AUTH_SECRET: "test-secret-".repeat(4),
      AUTH_INTERNAL_SECRET: "test-internal",
      GITHUB_CLIENT_ID: "fixture",
      GITHUB_CLIENT_SECRET: "fixture",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: process.env.AUTH_TEST_SMTP_PORT ?? "51025",
    });
    const { database, auth } = await (await import("./node-auth")).createNodeRuntime(process.env);
    await migrateAuth(database);
    let requestNumber = 0;
    const prefix = randomUUID();
    let profile = { id: prefix, email: `${prefix}@example.test`, login: "Fixture" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.includes("/login/oauth/access_token"))
        return Response.json({
          access_token: "fixture-token",
          token_type: "bearer",
          scope: "read:user,user:email",
        });
      if (url === "https://api.github.com/user") return Response.json(profile);
      if (url === "https://api.github.com/user/emails") return Response.json([]);
      throw new Error(`Unexpected fetch: ${url}`);
    });
    const cookieFrom = (response: Response) =>
      response.headers
        .getSetCookie()
        .map((v) => v.split(";")[0])
        .join("; ");
    const call = (path: string, body?: object, cookie = "", source = origin) =>
      auth.handler(
        new Request(`${origin}/api/auth/${path}`, {
          method: body ? "POST" : "GET",
          headers: {
            "x-forwarded-for": `192.0.2.${++requestNumber}`,
            Origin: source,
            Cookie: cookie,
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        }),
      );
    async function oauth(path = "sign-in/social", cookie = "") {
      const start = await call(
        path,
        {
          provider: "github",
          callbackURL: `${origin}/practice`,
          errorCallbackURL: `${origin}/login${path === "link-social" ? "?linkSocial=1" : ""}`,
        },
        cookie,
      );
      expect(start.status).toBe(200);
      const state = new URL((await start.json()).url).searchParams.get("state");
      return call(
        `callback/github?code=fixture&state=${state}`,
        undefined,
        Array.from(
          new Map(
            `${cookie}; ${cookieFrom(start)}`
              .split("; ")
              .filter(Boolean)
              .map((value) => [value.split("=")[0], value]),
          ).values(),
        ).join("; "),
      );
    }
    try {
      const signed = await oauth();
      expect(signed.status).toBe(302);
      expect(signed.headers.get("location")).toBe(`${origin}/practice`);
      const cookie = cookieFrom(signed);
      const user = (await database.query('SELECT * FROM "user" WHERE email=$1', [profile.email]))
        .rows[0];
      expect(user.emailVerified).toBe(true);
      expect((await call("list-accounts", undefined, cookie)).status).toBe(200);
      const account = (await (await call("list-accounts", undefined, cookie)).json())[0];
      expect((await call("unlink-account", { accountId: account.id }, cookie)).status).toBe(400);
      expect((await call("link-social", { provider: "github" })).status).toBe(401);
      expect(
        (await call("link-social", { provider: "github" }, cookie, "https://evil.example")).status,
      ).toBe(403);
      // A different provider identity with the same email must never inherit this session.
      profile = { ...profile, id: `${prefix}-other` };
      const collision = await oauth();
      expect(collision.headers.get("location")).toContain("account_not_linked");
      expect(cookieFrom(collision)).not.toContain("session_token");
      const linked = await oauth("link-social", cookie);
      expect(linked.headers.get("location")).toBe(`${origin}/practice`);
      expect((await oauth()).headers.get("location")).toBe(`${origin}/practice`);
      const connections = await (await call("list-accounts", undefined, cookie)).json();
      expect(connections).toHaveLength(2);
      expect((await call("unlink-account", { accountId: connections[1].id }, cookie)).status).toBe(
        200,
      );
      // Password reset is the email-confirmed first-password path for social-first users.
      let resetToken: string;
      if (process.env.AUTH_TEST_MAILPIT_URL) {
        expect(
          (
            await call("request-password-reset", {
              email: user.email,
              redirectTo: `${origin}/login?reset=1`,
            })
          ).status,
        ).toBe(200);
        const verification = await database.query(
          "SELECT identifier FROM verification WHERE value=$1 AND identifier LIKE 'reset-password:%'",
          [user.id],
        );
        resetToken = verification.rows[0].identifier.slice("reset-password:".length);
      } else {
        resetToken = randomUUID();
        await database.query(
          'INSERT INTO verification(id,identifier,value,"expiresAt","createdAt","updatedAt") VALUES($1,$2,$3,NOW()+interval \'1 hour\',NOW(),NOW())',
          [randomUUID(), `reset-password:${resetToken}`, user.id],
        );
      }
      expect(
        (await call("reset-password", { token: resetToken, newPassword: "SocialFirst1!" })).status,
      ).toBe(200);
      expect(
        (await call("sign-in/email", { email: user.email, password: "SocialFirst1!" })).status,
      ).toBe(200);
      profile = { id: `${prefix}-missing`, email: "", login: "Missing" };
      const missing = await oauth();
      expect(missing.headers.get("location")).toBe(`${origin}/login?socialEmail=1`);
      const proof = cookieFrom(missing);
      expect(proof).toContain("quorem_social_email=");
      expect(
        (await database.query('SELECT 1 FROM account WHERE "accountId"=$1', [profile.id])).rowCount,
      ).toBe(0);
      // Mail sender fixture exercises the same handler without external delivery.
      const { socialEmail } = await import("./social-email");
      let link = "";
      const { drizzleAuthRepository } = await import("./adapters/drizzle-auth-repository.ts");
      const { withNodeConnection } = await import("@quorem/database/core");
      const repository = drizzleAuthRepository(callback => withNodeConnection(database, { lifetimeMs: 15000 }, callback));
      const flow = socialEmail(repository, origin, async (_email, url) => {
        link = url;
      });
      const emailCall = (path: string, body: object, cookies = proof) =>
        flow.handle(
          new Request(`${origin}/api/auth/social-email/${path}`, {
            method: "POST",
            headers: { Origin: origin, Cookie: cookies, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
          async () => new Response(null, { status: 404 }),
        );
      const email = `${prefix}-missing@example.test`;
      expect((await emailCall("start", { email })).status).toBe(200);
      const token = new URL(link).searchParams.get("socialEmailToken");
      expect((await emailCall("verify", { token }, "")).status).toBe(401);
      expect((await emailCall("verify", { token })).status).toBe(200);
      expect((await emailCall("verify", { token })).status).toBe(400);
      const completed = await oauth();
      expect(completed.headers.get("location")).toBe(`${origin}/practice`);
      expect(
        (await database.query('SELECT "emailVerified" FROM "user" WHERE email=$1', [email])).rows[0]
          .emailVerified,
      ).toBe(true);
      expect((await oauth()).headers.get("location")).toBe(`${origin}/practice`);
      const loggedIn = await call("sign-in/email", {
        email: user.email,
        password: "SocialFirst1!",
      });
      const ownerCookie = cookieFrom(loggedIn);
      profile = { id: `${prefix}-missing-link`, email: "", login: "MissingLink" };
      const missingLink = await oauth("link-social", ownerCookie);
      expect(missingLink.headers.get("location")).toBe(`${origin}/login?socialEmail=1`);
      const linkProof = cookieFrom(missingLink);
      expect(
        (await emailCall("start", { email: `${prefix}-link@example.test` }, linkProof)).status,
      ).toBe(200);
      const linkedVerification = await emailCall(
        "verify",
        { token: new URL(link).searchParams.get("socialEmailToken") },
        linkProof,
      );
      expect(await linkedVerification.json()).toEqual({ provider: "github", linking: true });
      expect((await oauth("link-social", ownerCookie)).headers.get("location")).toBe(
        `${origin}/practice`,
      );
      expect(
        (await database.query('SELECT "userId" FROM account WHERE "accountId"=$1', [profile.id]))
          .rows[0].userId,
      ).toBe(user.id);
    } finally {
      fetchMock.mockRestore();
      await database.query('DELETE FROM "user" WHERE email LIKE $1', [`${prefix}%`]);
      await database.query("DELETE FROM social_email WHERE account_id LIKE $1", [`${prefix}%`]);
      await database.end();
    }
  });
});
