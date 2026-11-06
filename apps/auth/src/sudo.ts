/** @file sudo.ts @description Session-bound reauthentication through Better Auth and its verification store. @module auth */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { sudoExpiresAt, sudoLifetimeSeconds } from "@quorem/contracts/auth-policy";
import type { createAuth } from "./auth.ts";
import type { AuthRepository } from "./auth-repository.ts";

type Auth = ReturnType<typeof createAuth>;
const json = (status: number, value: unknown, retryAfter?: number) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}),
    },
  });

export function createSudoHandler(options: {
  auth: Auth;
  repository: AuthRepository;
  origin: string;
  secret: string;
  passkey: boolean;
  send?: (email: string, code: string) => Promise<void>;
}) {
  return async (request: Request): Promise<Response> => {
    try {
      const path = new URL(request.url).pathname.replace("/api/auth/sudo/", "");
      if (
        !(
          (request.method === "GET" && path === "status") ||
          (request.method === "POST" && ["password", "send-code", "email-code"].includes(path))
        )
      )
        return json(404, {});
      if (request.method === "POST" && request.headers.get("origin") !== options.origin)
        return json(403, {});
      const current = await options.auth.api.getSession({ headers: request.headers });
      if (!current?.user.emailVerified) return json(401, {});
      const { session, user } = current;
      const authority = await options.repository.sessionAuthority(session.id, user.id);
      if (!authority.valid) return json(401, {});
      const context = await options.auth.$context;
      const identifier = `sudo:${session.id}:${user.id}:${user.email}`;
      const digest = (code: string) =>
        createHmac("sha256", options.secret).update(`${identifier}:${code}`).digest("hex");
      if (path === "status") {
        const accounts = await context.internalAdapter.findAccounts(user.id);
        const keys = options.passkey
          ? await context.adapter.count({
              model: "passkey",
              where: [{ field: "userId", value: user.id }],
            })
          : 0;
        return json(200, {
          userId: user.id,
          until: sudoExpiresAt(authority.strongAt, Math.floor(Date.now() / 1000)),
          methods: {
            password: accounts.some(
              (account) => account.providerId === "credential" && !!account.password,
            ),
            passkey: keys > 0,
            email: !!options.send,
          },
        });
      }
      const limit = await options.repository.rateLimit(
        `sudo:${path}`,
        user.id,
        path === "send-code"
          ? { limit: 1, seconds: 60 }
          : { limit: 5, seconds: sudoLifetimeSeconds },
      );
      if (!limit.allowed) return json(429, {}, limit.retryAfter);
      if (path === "password") {
        let verified = false;
        // Better Auth owns password lookup, hashing and current-session binding.
        const raw = await readBody(request);
        if (!raw || typeof raw.password !== "string" || raw.password.length > 128)
          return json(400, {});
        try {
          verified =
            (
              await options.auth.api.verifyPassword({
                headers: request.headers,
                body: { password: raw.password },
              })
            ).status === true;
        } catch (error) {
          if (
            error &&
            typeof error === "object" &&
            "statusCode" in error &&
            [400, 401, 403].includes(Number(error.statusCode))
          )
            return json(400, { code: "invalid_password" });
          throw error;
        }
        if (!verified) return json(400, { code: "invalid_password" });
      } else if (path === "send-code") {
        if (!options.send) return json(400, {});
        const hourly = await options.repository.rateLimit("sudo:mail-hour", user.id, {
          limit: 5,
          seconds: 3600,
        });
        if (!hourly.allowed) return json(429, {}, hourly.retryAfter);
        const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
        await context.internalAdapter.deleteVerificationByIdentifier(identifier);
        await context.internalAdapter.createVerificationValue({
          identifier,
          value: digest(code),
          expiresAt: new Date(Date.now() + 300_000),
        });
        await options.send(user.email, code);
        return json(200, { sent: true });
      } else {
        if (!options.send) return json(400, {});
        const raw = await readBody(request);
        if (!raw || typeof raw.code !== "string" || !/^\d{6}$/.test(raw.code)) return json(400, {});
        const expected = digest(raw.code);
        const candidate = await context.internalAdapter.findVerificationValue(identifier);
        const matches = (value: string) =>
          value.length === expected.length &&
          timingSafeEqual(Buffer.from(value), Buffer.from(expected));
        if (!candidate || candidate.expiresAt.getTime() <= Date.now() || !matches(candidate.value))
          return json(400, { code: "invalid_code" });
        // Atomic consumption prevents replay, including concurrent verification and resend races.
        const consumed = await context.internalAdapter.consumeVerificationValue(identifier);
        if (!consumed || !matches(consumed.value)) return json(400, { code: "invalid_code" });
      }
      await options.repository.recordAssurance(session.id);
      return json(200, { verified: true });
    } catch {
      return json(503, {});
    }
  };
}

async function readBody(request: Request): Promise<Record<string, unknown> | undefined> {
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  let raw = "";
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (raw.length + value.length > 1024) {
        await reader.cancel();
        return undefined;
      }
      raw += decoder.decode(value, { stream: true });
    }
    const body: unknown = JSON.parse(raw + decoder.decode());
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  } finally {
    reader.releaseLock();
  }
}
