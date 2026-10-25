import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import type { google } from "better-auth/social-providers";
import { emailSchema } from "@quorem/contracts/auth";
import type { VerificationSender } from "./email-delivery.ts";
import { takeRateLimit } from "./rate-limit.ts";

type Tokens = Parameters<ReturnType<typeof google>["getUserInfo"]>[0];
type User = { email?: string | null; emailVerified: boolean; name?: string; image?: string };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const opaque = () => randomBytes(32).toString("base64url");
const cookieName = "quorem_social_email";
const json = (status: number, body: object) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/** Keep provider proof request-local; never invent an email or create an incomplete user. */
export function socialEmail(database: Pool, origin: string, send?: VerificationSender) {
  const pending = new AsyncLocalStorage<{ identity?: { provider: string; accountId: string } }>();
  function provider<Profile extends object>(source: {
    id: string;
    getUserInfo: (tokens: Tokens) => Promise<{ user: User; data: Profile } | null>;
    accountSubject: (context: { tokens: Tokens; profile: Profile }) => unknown;
  }) {
    const id = source.id;
    return async (tokens: Tokens) => {
      const result = await source.getUserInfo(tokens);
      if (!result?.user) return result;
      // Provider-supplied emails satisfy policy; collect local proof only when absent.
      if (result.user.email) {
        const parsed = emailSchema.safeParse(result.user.email);
        if (!parsed.success) return null;
        return { ...result, user: { ...result.user, email: parsed.data, emailVerified: true } };
      }
      const subject = await source.accountSubject({ tokens, profile: result.data });
      const accountId = String(subject);
      if (!accountId || ["undefined", "null"].includes(accountId)) return null;
      const saved = await database.query(
        `SELECT u.email FROM account a JOIN "user" u ON u.id=a."userId" WHERE a."providerId"=$1 AND a."accountId"=$2
         UNION ALL SELECT email FROM social_email WHERE provider=$1 AND account_id=$2 AND verified=true AND expires_at>NOW() LIMIT 1`,
        [id, accountId],
      );
      if (saved.rows[0]?.email)
        return {
          ...result,
          user: { ...result.user, email: saved.rows[0].email, emailVerified: true },
        };
      const current = pending.getStore();
      if (current) current.identity = { provider: id, accountId };
      return result;
    };
  }
  async function handle(request: Request, next: (request: Request) => Promise<Response>) {
    const url = new URL(request.url);
    const proof =
      request.headers
        .get("cookie")
        ?.split(";")
        .map((v) => v.trim())
        .find((v) => v.startsWith(`${cookieName}=`))
        ?.slice(cookieName.length + 1) ?? "";
    if (url.pathname.startsWith("/api/auth/social-email/")) {
      if (request.method !== "POST") return json(405, {});
      if (request.headers.get("origin") !== origin) return json(403, {});
      if (
        !/^[A-Za-z0-9_-]{43}$/.test(proof) ||
        !(
          await database.query(
            "SELECT 1 FROM social_email WHERE proof_hash=$1 AND expires_at>NOW()",
            [hash(proof)],
          )
        ).rowCount
      )
        return json(401, {});
      const limit = await takeRateLimit(database, "social-email:requests", hash(proof), {
        limit: 10,
        seconds: 60,
      });
      if (!limit.allowed) return json(429, {});
      const reader = request.body?.getReader();
      let raw = "";
      if (reader) {
        let size = 0;
        const decoder = new TextDecoder();
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 2048) {
            await reader.cancel();
            return json(413, {});
          }
          raw += decoder.decode(chunk.value, { stream: true });
        }
        raw += decoder.decode();
      }
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return json(400, {});
      }
      if (url.pathname.endsWith("/verify")) {
        if (typeof body?.token !== "string") return json(400, {});
        const result = await database.query(
          "UPDATE social_email SET verified=true,token_hash=NULL,expires_at=NOW()+interval '15 minutes' WHERE proof_hash=$1 AND token_hash=$2 AND expires_at>NOW() RETURNING provider,linking",
          [hash(proof), hash(body.token)],
        );
        return result.rowCount
          ? json(200, { provider: result.rows[0].provider, linking: result.rows[0].linking })
          : json(400, {});
      }
      if (!url.pathname.endsWith("/start")) return json(404, {});
      const parsed = emailSchema.safeParse(body?.email);
      if (!parsed.success) return json(400, {});
      if (!send) return json(503, {});
      for (const [scope, subject, policy] of [
        ["social-email:cooldown", parsed.data, { limit: 1, seconds: 60 }],
        ["social-email:hour", parsed.data, { limit: 5, seconds: 3600 }],
        ["social-email:global", "global", { limit: 100, seconds: 3600 }],
      ] as const) {
        if (!(await takeRateLimit(database, scope, subject, policy)).allowed) return json(429, {});
      }
      const token = opaque();
      const result = await database.query(
        "UPDATE social_email SET email=$2,token_hash=$3,verified=false WHERE proof_hash=$1 AND expires_at>NOW() RETURNING provider",
        [hash(proof), parsed.data, hash(token)],
      );
      if (!result.rowCount) return json(401, {});
      const link = new URL("/login", origin);
      link.searchParams.set("socialEmailToken", token);
      try {
        await send(parsed.data, link.toString());
      } catch {
        return json(503, {});
      }
      return json(200, { retryAfter: 60 });
    }
    return pending.run({}, async () => {
      const response = await next(request);
      const identity = pending.getStore()?.identity;
      const redirect = response.headers.get("location");
      if (
        !identity ||
        !redirect ||
        !["email_not_found", "email_does_not_match", "unable_to_link_account"].includes(
          new URL(redirect, origin).searchParams.get("error") ?? "",
        )
      )
        return response;
      const value = opaque();
      await database.query("DELETE FROM social_email WHERE expires_at<NOW()");
      await database.query(
        "INSERT INTO social_email(proof_hash,provider,account_id,linking,expires_at) VALUES($1,$2,$3,$4,NOW()+interval '1 hour')",
        [
          hash(value),
          identity.provider,
          identity.accountId,
          new URL(redirect, origin).searchParams.get("linkSocial") === "1",
        ],
      );
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${origin}/login?socialEmail=1`,
          "Set-Cookie": `${cookieName}=${value}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=3600${origin.startsWith("https:") ? "; Secure" : ""}`,
          "Cache-Control": "no-store",
        },
      });
    });
  }
  return { provider, handle };
}
