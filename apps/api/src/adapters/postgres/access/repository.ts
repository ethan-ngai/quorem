import { and, eq, inArray, isNull, lte, or, gt, sql } from "drizzle-orm";
import { product } from "@quorem/database/schema";
import type { ConnectionScope } from "@quorem/database/core";
import type { Capabilities, CapabilityReader } from "../../../modules/access/model.ts";

const { users, entitlement_grants: grants, quota_overrides: quotas } = product;
export function capabilityRepository(scope: ConnectionScope): CapabilityReader {
  return {
    async capabilities(userId) {
      return scope.transaction(
        {
          statementTimeoutMs: 3000,
          lockTimeoutMs: 1000,
          readOnly: true,
          isolation: "repeatable read",
        },
        async (tx) => {
          const [user] = await tx
            .select({ kind: users.kind, disabled: users.disabled, role: users.role })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
          if (!user) throw new Error("Identity missing");
          const result: Capabilities = {
            authorCustomQuestions: false,
            interviewConcurrency: 1,
            hostGuests: false,
            hostedIntelligence: false,
            experimental: false,
            interviews: false,
            guestConcurrency: 2,
          };
          if (user.kind !== "account" || user.disabled) return result;
          const active = await tx
            .select({ feature: grants.feature })
            .from(grants)
            .where(
              and(
                eq(grants.user_id, userId),
                isNull(grants.revoked_at),
                lte(grants.valid_from, sql`clock_timestamp()`),
                or(isNull(grants.expires_at), gt(grants.expires_at, sql`clock_timestamp()`)),
                inArray(grants.feature, [
                  "internal",
                  "matches.host_guests",
                  "intelligence.hosted",
                  "experimental",
                  "interviews.host",
                  "questions.custom",
                ]),
              ),
            );
          const has = (feature: string) =>
            active.some((row) => row.feature === "internal" || row.feature === feature);
          result.hostGuests = has("matches.host_guests");
          result.hostedIntelligence = has("intelligence.hosted");
          result.experimental = has("experimental");
          result.interviews = has("interviews.host");
          result.authorCustomQuestions = user.role === "admin" || has("questions.custom");
          const overrides = await tx
            .select({ resource: quotas.resource, value: quotas.value })
            .from(quotas)
            .where(
              and(
                eq(quotas.user_id, userId),
                or(isNull(quotas.expires_at), gt(quotas.expires_at, sql`clock_timestamp()`)),
              ),
            );
          for (const row of overrides) {
            if (row.resource === "interview_concurrency")
              result.interviewConcurrency = Math.min(row.value, 100);
            if (row.resource === "guest_concurrency")
              result.guestConcurrency = Math.min(row.value, 8);
          }
          return result;
        },
      );
    },
  };
}
