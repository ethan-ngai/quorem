/** Email proof precedes credentials; opaque tokens are hashed and consumed under row locks. */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { Pool } from "pg";
import { emailSchema, accountSetupSchema } from "@quorem/contracts/auth";
import { takeRateLimit } from "./rate-limit.ts";

const cookieName = "quorem_registration";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const opaque = () => randomBytes(32).toString("base64url");
const json = (status: number, body: object, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });

export function createRegistrationHandler(options: {
  database: Pool;
  origin: string;
  send: (email: string, url: string) => Promise<void>;
}) {
  const { database, origin, send } = options;
  const cookie = (value: string, age = 900) =>
    `${cookieName}=${value}; Path=/api/auth/registration; HttpOnly; SameSite=Strict; Max-Age=${age}${origin.startsWith("https:") ? "; Secure" : ""}`;
  return async (request: Request): Promise<Response | undefined> => {
    const path = new URL(request.url).pathname;
    if (!path.startsWith("/api/auth/registration/")) return;
    const grant =
      request.headers
        .get("cookie")
        ?.split(";")
        .map((value) => value.trim())
        .find((value) => value.startsWith(`${cookieName}=`))
        ?.slice(cookieName.length + 1) ?? "";
    if (path.endsWith("/status") && request.method === "GET") {
      const found = await database.query(
        'SELECT r.email, COALESCE(u."emailVerified",false) AS registered FROM registration_email r LEFT JOIN "user" u ON u.email=r.email WHERE r.grant_hash=$1 AND r.expires_at>NOW()',
        [digest(grant)],
      );
      return found.rowCount
        ? json(200, found.rows[0])
        : json(401, { message: "This setup link expired. Request a new email." });
    }
    if (request.method !== "POST") return json(405, { message: "Method not allowed" });
    if (request.headers.get("origin") !== origin) return json(403, { message: "Invalid origin" });
    const requestLimit = await takeRateLimit(database, "registration:requests", "global", {
      limit: 60,
      seconds: 60,
    });
    if (!requestLimit.allowed)
      return json(
        429,
        { message: "Too many attempts. Try again shortly." },
        { "Retry-After": String(requestLimit.retryAfter) },
      );
    if (Number(request.headers.get("content-length")) > 4096)
      return json(413, { message: "Request too large" });
    const reader = request.body?.getReader();
    let raw = "",
      size = 0;
    const decoder = new TextDecoder();
    if (reader)
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4096) {
          await reader.cancel();
          return json(413, { message: "Request too large" });
        }
        raw += decoder.decode(value, { stream: true });
      }
    raw += decoder.decode();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw);
      if (!body || typeof body !== "object") throw new Error();
    } catch {
      return json(400, { message: "Invalid request" });
    }
    if (path.endsWith("/start")) {
      const parsed = emailSchema.safeParse(body.email);
      if (!parsed.success) return json(400, { message: "Enter a valid email address." });
      const email = parsed.data;
      const token = opaque();
      const link = new URL("/login", origin);
      if (typeof body.callbackURL === "string") {
        const callback = new URL(body.callbackURL, origin);
        if (callback.origin === origin && callback.pathname === "/login")
          link.search = callback.search;
      }
      link.searchParams.delete("verified");
      link.searchParams.delete("setup");
      link.searchParams.set("signupToken", token);
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 62))", [email]);
        for (const [scope, subject, policy] of [
          ["email:registration:cooldown", email, { limit: 1, seconds: 60 }],
          ["email:registration:hour", email, { limit: 5, seconds: 3600 }],
          ["email:registration:global", "global", { limit: 100, seconds: 3600 }],
        ] as const) {
          const limit = await takeRateLimit(client, scope, subject, policy);
          if (!limit.allowed) {
            await client.query("ROLLBACK");
            return json(200, { retryAfter: limit.retryAfter });
          }
        }
        await client.query(
          "DELETE FROM registration_email WHERE expires_at<NOW()-interval '1 day'",
        );
        await client.query("DELETE FROM rate_limit WHERE expires_at<NOW()-interval '1 day'");
        await client.query(
          "INSERT INTO registration_email(email,token_hash,expires_at,last_sent_at) VALUES($1,$2,NOW()+interval '1 hour',NOW()) ON CONFLICT(email) DO UPDATE SET token_hash=$2,grant_hash=NULL,expires_at=NOW()+interval '1 hour',last_sent_at=NOW()",
          [email, digest(token)],
        );
        // Roll back the challenge and send budgets on failure, allowing an immediate retry.
        await send(email, link.toString());
        await client.query("COMMIT");
        return json(200, { retryAfter: 60 });
      } catch {
        await client.query("ROLLBACK");
        return json(503, { message: "Could not send your email. Please try again." });
      } finally {
        client.release();
      }
    }
    if (path.endsWith("/verify")) {
      if (typeof body.token !== "string" || body.token.length !== 43)
        return json(400, { message: "This link is invalid. Request a new email." });
      const next = opaque();
      const result = await database.query(
        "UPDATE registration_email SET token_hash=NULL,grant_hash=$2,expires_at=NOW()+interval '15 minutes' WHERE token_hash=$1 AND expires_at>NOW() RETURNING email",
        [digest(body.token), digest(next)],
      );
      return result.rowCount
        ? json(200, {}, { "Set-Cookie": cookie(next) })
        : json(400, { message: "This link expired or was already used. Request a new email." });
    }
    if (path.endsWith("/complete")) {
      const parsed = accountSetupSchema.safeParse(body);
      if (!parsed.success) return json(400, { message: parsed.error.issues[0].message });
      const { username, password, name } = parsed.data;
      const client = await database.connect();
      try {
        await client.query("BEGIN");
        const proof = await client.query(
          "SELECT email FROM registration_email WHERE grant_hash=$1 AND expires_at>NOW() FOR UPDATE",
          [digest(grant)],
        );
        if (!proof.rowCount) {
          await client.query("ROLLBACK");
          return json(401, { message: "Your setup session expired. Request a new email." });
        }
        const email = proof.rows[0].email;
        if (parsed.data.email !== email) {
          await client.query("ROLLBACK");
          return json(409, {
            message: "Account setup changed in another tab. Open your email link again.",
          });
        }
        const existing = await client.query(
          'SELECT id,"emailVerified" FROM "user" WHERE email=$1 FOR UPDATE',
          [email],
        );
        if (existing.rows[0]?.emailVerified) {
          await client.query("ROLLBACK");
          return json(409, { message: "Your account is ready. Sign in instead." });
        }
        const id = existing.rows[0]?.id ?? randomUUID();
        const hash = await hashPassword(password);
        if (existing.rowCount) {
          // Email ownership permits replacing abandoned credentials, never inheriting their sessions.
          await client.query('DELETE FROM "session" WHERE "userId"=$1', [id]);
          await client.query('DELETE FROM passkey WHERE "userId"=$1', [id]);
          await client.query('DELETE FROM account WHERE "userId"=$1', [id]);
          await client.query(
            'UPDATE "user" SET name=$3,username=$2,"displayUsername"=$2,"emailVerified"=true,image=NULL,"updatedAt"=NOW() WHERE id=$1',
            [id, username, name],
          );
        } else
          await client.query(
            'INSERT INTO "user"(id,name,email,"emailVerified",username,"displayUsername","createdAt","updatedAt") VALUES($1,$4,$3,true,$2,$2,NOW(),NOW())',
            [id, username, email, name],
          );
        await client.query(
          'INSERT INTO account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2,\'credential\',$2,$3,NOW(),NOW())',
          [randomUUID(), id, hash],
        );
        await client.query("DELETE FROM registration_email WHERE email=$1", [email]);
        await client.query("COMMIT");
        return json(200, {}, { "Set-Cookie": cookie("", 0) });
      } catch (error) {
        await client.query("ROLLBACK");
        return (error as { code?: string }).code === "23505"
          ? json(409, { message: "That username is taken. Choose another." })
          : json(503, { message: "Could not finish setup. Please try again." });
      } finally {
        client.release();
      }
    }
    return json(404, { message: "Not found" });
  };
}
