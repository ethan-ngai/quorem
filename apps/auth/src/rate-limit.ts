/** Atomic, persistent fixed-window limits; subjects are hashed rather than stored as identifiers. */
import { createHash } from "node:crypto";
import type { Pool } from "pg";

export async function takeRateLimit(
  database: Pick<Pool, "query">,
  scope: string,
  subject: string,
  policy: { limit: number; seconds: number },
): Promise<{ allowed: boolean; retryAfter: number }> {
  if (
    !Number.isInteger(policy.limit) ||
    policy.limit < 1 ||
    !Number.isInteger(policy.seconds) ||
    policy.seconds < 1
  )
    throw new Error("Invalid rate limit policy");
  const bucket = createHash("sha256")
    .update(JSON.stringify([scope, subject]))
    .digest("hex");
  const result = await database.query(
    `INSERT INTO rate_limit(bucket,used,expires_at) VALUES($1,1,NOW()+$3*interval '1 second')
     ON CONFLICT(bucket) DO UPDATE SET
       used=CASE WHEN rate_limit.expires_at<=NOW() THEN 1 ELSE rate_limit.used+1 END,
       expires_at=CASE WHEN rate_limit.expires_at<=NOW() THEN NOW()+$3*interval '1 second' ELSE rate_limit.expires_at END
     WHERE rate_limit.expires_at<=NOW() OR rate_limit.used<$2
     RETURNING GREATEST(1,CEIL(EXTRACT(EPOCH FROM expires_at-NOW())))::integer AS retry`,
    [bucket, policy.limit, policy.seconds],
  );
  if (result.rowCount) return { allowed: true, retryAfter: result.rows[0].retry };
  const blocked = await database.query(
    "SELECT GREATEST(1,CEIL(EXTRACT(EPOCH FROM expires_at-NOW())))::integer AS retry FROM rate_limit WHERE bucket=$1",
    [bucket],
  );
  return { allowed: false, retryAfter: blocked.rows[0]?.retry ?? policy.seconds };
}
