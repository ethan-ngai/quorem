import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { migrateAuth } from "./migrations";
const url = process.env.AUTH_TEST_DATABASE_URL,
  inbox = process.env.AUTH_TEST_MAILPIT_URL;
describe.skipIf(!url || !inbox)(
  "profile and recovery with disposable PostgreSQL and Mailpit",
  () => {
    it("validates profile edits, verifies both email addresses, resets passwords once and revokes sessions", async () => {
      const origin = "http://localhost:5180";
      Object.assign(process.env, {
        APP_ENV: "local",
        AUTH_MODE: "password",
        AUTH_ORIGIN: origin,
        BETTER_AUTH_SECRET: "mock-secret-".repeat(4),
        AUTH_DATABASE_URL: url,
        AUTH_INTERNAL_SECRET: "mock-internal-secret",
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: process.env.AUTH_TEST_SMTP_PORT ?? "51025",
      });
      const { auth, createAuth, database } = await (await import("./node-auth")).createNodeRuntime(process.env);
      await migrateAuth(database);
      const username = `edit${randomUUID().replaceAll("-", "").slice(0, 14)}`,
        email = `${username}@example.test`,
        newEmail = `new-${email}`,
        password = "Original1!";
      const signup = await createAuth(true).handler(
        new Request(`${origin}/api/auth/sign-up/email`, {
          method: "POST",
          headers: { Origin: origin, "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Original", username, email, password }),
        }),
      );
      const id = (await signup.json()).user.id;
      const call = (path: string, body?: object, cookie = "", source = origin) =>
        auth.handler(
          new Request(`${origin}/api/auth/${path}`, {
            method: body ? "POST" : "GET",
            headers: {
              Origin: source,
              Cookie: cookie,
              ...(body ? { "Content-Type": "application/json" } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
          }),
        );
      async function clearLimits(address: string) {
        const scopes = [
          "email:account:cooldown",
          "email:account:hour",
          "account:requests:/request-password-reset:60",
          "account:requests:/request-password-reset:3600",
          "account:requests:/change-email:60",
          "account:requests:/change-email:3600",
        ];
        await database.query("DELETE FROM rate_limit WHERE bucket=ANY($1)", [
          scopes.map((scope) =>
            createHash("sha256")
              .update(JSON.stringify([scope, address]))
              .digest("hex"),
          ),
        ]);
      }
      async function mailLink(address: string, subject: string) {
        const list = await (await fetch(`${inbox}/api/v1/messages?limit=500`)).json();
        const mail = list.messages.find(
          (message: { Subject: string; To: { Address: string }[] }) =>
            message.Subject === subject && message.To.some((to) => to.Address === address),
        );
        expect(mail).toBeTruthy();
        const content = await (await fetch(`${inbox}/api/v1/message/${mail.ID}`)).json();
        return String(content.Text).match(/http:\/\/localhost:5180\/[^\s]+/)![0];
      }
      try {
        await database.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [id]);
        const login = await call("sign-in/username", { username, password });
        expect(login.status).toBe(200);
        const cookie = login.headers
          .getSetCookie()
          .map((value) => value.split(";")[0])
          .join("; ");
        expect((await call("update-user", { username: "Bad_Name" }, cookie)).status).toBe(400);
        expect((await call("update-user", { name: "Bad\nName" }, cookie)).status).toBe(400);
        expect(
          (await call("update-user", { name: "Other" }, cookie, "https://evil.example")).status,
        ).toBe(403);
        expect(
          (
            await call(
              "update-user",
              { name: "", username: `${username}2`, displayUsername: `${username}2` },
              cookie,
            )
          ).status,
        ).toBe(200);
        expect(
          (await database.query('SELECT name,username FROM "user" WHERE id=$1', [id])).rows[0],
        ).toEqual({ name: "", username: `${username}2` });
        await clearLimits(newEmail);
        await clearLimits(email);
        expect(
          (
            await call(
              "change-email",
              { newEmail, callbackURL: `${origin}/login?emailChangePending=1` },
              cookie,
            )
          ).status,
        ).toBe(200);
        expect(
          (await database.query('SELECT email FROM "user" WHERE id=$1', [id])).rows[0].email,
        ).toBe(email);
        const oldLink = await mailLink(email, "Confirm your Quorem email change");
        expect((await auth.handler(new Request(oldLink))).status).toBe(302);
        expect(
          (await database.query('SELECT email FROM "user" WHERE id=$1', [id])).rows[0].email,
        ).toBe(email);
        const duplicateConfirmation = await auth.handler(new Request(oldLink));
        expect(duplicateConfirmation.status).toBe(429);
        expect(Number(duplicateConfirmation.headers.get("retry-after"))).toBeGreaterThan(0);
        const newLink = await mailLink(newEmail, "Verify your new Quorem email");
        const verified = await auth.handler(new Request(newLink));
        expect(verified.status).toBe(302);
        expect(verified.headers.get("location")).toContain("emailChanged=1");
        expect(
          (await database.query('SELECT email,"emailVerified" FROM "user" WHERE id=$1', [id]))
            .rows[0],
        ).toEqual({ email: newEmail, emailVerified: true });
        await clearLimits(newEmail);
        expect(
          (
            await call("request-password-reset", {
              email: newEmail,
              redirectTo: `${origin}/login?reset=1`,
            })
          ).status,
        ).toBe(200);
        const blocked = await call("request-password-reset", {
          email: newEmail,
          redirectTo: `${origin}/login?reset=1`,
        });
        expect(blocked.status).toBe(429);
        expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
        const resetLink = await mailLink(newEmail, "Reset your Quorem password");
        const resetPath = new URL(resetLink).pathname;
        const token = resetPath.split("/").pop()!;
        expect((await call("reset-password", { token, newPassword: "abcdefgh" })).status).toBe(400);
        expect((await call("reset-password", { token, newPassword: "Changed1!" })).status).toBe(
          200,
        );
        expect(
          (await database.query('SELECT 1 FROM "session" WHERE "userId"=$1', [id])).rowCount,
        ).toBe(0);
        expect((await call("reset-password", { token, newPassword: "Another1!" })).status).toBe(
          400,
        );
        expect(
          (await call("sign-in/username", { username: `${username}2`, password })).status,
        ).toBe(401);
        expect(
          (await call("sign-in/username", { username: `${username}2`, password: "Changed1!" }))
            .status,
        ).toBe(200);
      } finally {
        await database.query('DELETE FROM "user" WHERE id=$1', [id]);
        await database.end();
      }
    });
  },
);
