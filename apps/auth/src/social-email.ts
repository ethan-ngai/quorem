import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes } from "node:crypto";
import type { AuthRepository } from "./auth-repository.ts";
import type { google } from "better-auth/social-providers";
import { emailSchema } from "@quorem/contracts/auth";
import type { VerificationSender } from "./email-delivery.ts";

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
export function socialEmail(repository: AuthRepository, origin: string, send?: VerificationSender) {
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
      const saved = await repository.socialEmail(id, accountId);
      if (saved)
        return { ...result, user: { ...result.user, email: saved, emailVerified: true } };
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
        !(await repository.hasSocialProof(hash(proof)))
      )
        return json(401, {});
      const limit = await repository.rateLimit("social-email:requests", hash(proof), {
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
        const result = await repository.verifySocialProof(hash(proof), hash(body.token));
        return result ? json(200, result) : json(400, {});
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
        if (!(await repository.rateLimit(scope, subject, policy)).allowed) return json(429, {});
      }
      const token = opaque();
      if (!(await repository.setSocialEmail(hash(proof), parsed.data, hash(token)))) return json(401, {});
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
      await repository.createSocialProof(
        hash(value), identity.provider, identity.accountId,
        new URL(redirect, origin).searchParams.get("linkSocial") === "1",
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
