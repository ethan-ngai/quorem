/** @file active-grants.ts @description Transactional active entitlement selection. @module access */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";

export async function activeGrants(
  tx: Transaction,
  userId: string,
  features: readonly string[],
  lock: "read" | "share",
): Promise<Set<string>> {
  const rows = await tx.execute<{ feature: string }>(sql`
    SELECT feature FROM entitlement_grants
    WHERE user_id=${userId} AND feature IN (${sql.join(
      ["internal", ...features].map((feature) => sql`${feature}`),
      sql`,`,
    )})
      AND revoked_at IS NULL AND valid_from<=clock_timestamp()
      AND (expires_at IS NULL OR expires_at>clock_timestamp())
    ${lock === "share" ? sql`FOR SHARE` : sql``}
  `);
  return new Set(rows.rows.map((row) => row.feature));
}

export function hasGrant(grants: ReadonlySet<string>, feature: string): boolean {
  return grants.has("internal") || grants.has(feature);
}
