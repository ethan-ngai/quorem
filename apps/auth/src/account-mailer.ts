import { APIError } from "better-auth/api";
import type { Pool } from "pg";
import type { VerificationSender } from "./email-delivery.ts";
import { takeRateLimit } from "./rate-limit.ts";

/** Shared delivery budgets also cover verification emails triggered by clicking links. */
export function accountMailer(database: Pool, deliver: VerificationSender) {
  return async (email: string, url: string, subject: string, instruction: string) => {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      for (const [scope, key, policy] of [
        ["email:account:cooldown", email.toLowerCase(), { limit: 1, seconds: 60 }],
        ["email:account:hour", email.toLowerCase(), { limit: 5, seconds: 3600 }],
        ["email:account:global", "global", { limit: 100, seconds: 3600 }],
      ] as const) {
        const limit = await takeRateLimit(client, scope, key, policy);
        if (!limit.allowed)
          throw new APIError(
            "TOO_MANY_REQUESTS",
            { message: `Try again in ${limit.retryAfter} seconds.` },
            { "Retry-After": String(limit.retryAfter) },
          );
      }
      await deliver(email, url, { subject, instruction });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };
}
