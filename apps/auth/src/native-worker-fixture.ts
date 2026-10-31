import { withWorkerConnection } from "@quorem/database/core";
import { sql } from "drizzle-orm";
import { workerRuntime } from "./worker.ts";

interface Env {
  DB: { connectionString: string };
}
const messages: { email: string; url: string; transactions: number }[] = [];
export default {
  async fetch(request: Request, env: Env) {
    const run = <T>(callback: Parameters<typeof withWorkerConnection<T>>[2]) =>
      withWorkerConnection(
        env.DB.connectionString,
        { connectionTimeoutMs: 2000, lifetimeMs: 15000 },
        callback,
      );
    const transport = async (email: string, url: string) => {
      const transactions = await run((scope) =>
        scope.transaction(
          { statementTimeoutMs: 2000, lockTimeoutMs: 1000, readOnly: true },
          async (tx) =>
            Number(
              (
                await tx.execute(
                  sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'`,
                )
              ).rows[0].n,
            ),
        ),
      );
      messages.push({ email, url, transactions });
    };
    const runtime = workerRuntime(
      {
        ...env,
        APP_ENV: "local",
        AUTH_MODE: "password",
        AUTH_ORIGIN: "http://localhost:58738",
        AUTH_INTERNAL_SECRET: "fixture-only",
        BETTER_AUTH_SECRET: "mock-secret-".repeat(4),
        AUTH_EMAIL_DRIVER: "cloudflare",
        AUTH_EMAIL_CLOUDFLARE_ACCOUNT_ID: "0".repeat(32),
        AUTH_EMAIL_CLOUDFLARE_API_TOKEN: "fixture-only",
        AUTH_EMAIL_FROM: "fixture@example.test",
        AUTH_MAIL_INTENT_KEY: "07".repeat(32),
      },
      request.signal,
      () => transport,
    );
    const url = new URL(request.url);
    if (url.pathname === "/fixture/mail")
      return Response.json(
        messages.filter((message) => message.email === url.searchParams.get("email")),
      );
    if (url.pathname === "/fixture/authority")
      return Response.json(
        await runtime.repository.sessionAuthority(
          url.searchParams.get("session") ?? "",
          url.searchParams.get("subject") ?? "",
        ),
      );
    if (url.pathname === "/fixture/signup") {
      const next = new URL("/api/auth/sign-up/email", request.url);
      return runtime.makeAuth(true).handler(new Request(next, request));
    }
    return runtime.app.fetch(request);
  },
};
