import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { auth } from "@quorem/database/schema";
import type { ConnectionScope } from "@quorem/database/core";
import type { AuthRepository } from "../auth-repository.ts";

type RunScope = <T>(callback: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
const { userInQuorem_auth: user, accountInQuorem_auth: account, rate_limitInQuorem_auth: rate, session_assuranceInQuorem_auth: assurance, sessionInQuorem_auth: session, social_emailInQuorem_auth: social } = auth;
const options = { statementTimeoutMs: 5000, lockTimeoutMs: 5000 };

export function drizzleAuthRepository(run: RunScope): AuthRepository {
  return {
    rateLimit(scope, subject, policy) {
      if (!Number.isInteger(policy.limit) || policy.limit < 1 || !Number.isInteger(policy.seconds) || policy.seconds < 1) throw new Error("Invalid rate limit policy");
      const bucket=createHash("sha256").update(JSON.stringify([scope,subject])).digest("hex");
      return run(connection => connection.transaction(options, async tx => {
        const result=await tx.execute(sql`INSERT INTO ${rate} AS r(bucket,used,expires_at) VALUES(${bucket},1,NOW()+${policy.seconds}*interval '1 second') ON CONFLICT(bucket) DO UPDATE SET used=CASE WHEN r.expires_at<=NOW() THEN 1 ELSE r.used+1 END, expires_at=CASE WHEN r.expires_at<=NOW() THEN NOW()+${policy.seconds}*interval '1 second' ELSE r.expires_at END WHERE r.expires_at<=NOW() OR r.used<${policy.limit} RETURNING GREATEST(1,CEIL(EXTRACT(EPOCH FROM expires_at-NOW())))::integer AS retry`);
        if (result.rows.length) return {allowed:true,retryAfter:Number(result.rows[0].retry)};
        const blocked=await tx.execute(sql`SELECT GREATEST(1,CEIL(EXTRACT(EPOCH FROM expires_at-NOW())))::integer AS retry FROM ${rate} WHERE bucket=${bucket}`);
        return {allowed:false,retryAfter:Number(blocked.rows[0]?.retry ?? policy.seconds)};
      }));
    },
    profile(id) { return run(connection => connection.transaction({...options,readOnly:true},async tx => (await tx.select({profile_color:user.profile_color,profile_color_revision:user.profile_color_revision}).from(user).where(sql`${user.id}=${id}`).limit(1))[0])); },
    recordAssurance(id) { return run(connection => connection.transaction(options,async tx => { await tx.execute(sql`INSERT INTO ${assurance}(session_id) VALUES(${id}) ON CONFLICT(session_id) DO UPDATE SET strong_at=clock_timestamp()`); })); },
    sessionAuthority(sessionId,subject) { return run(connection => connection.transaction({...options,readOnly:true},async tx => {
      const result=await tx.execute(sql`SELECT EXTRACT(EPOCH FROM a.strong_at)::bigint AS strong_at FROM ${session} s JOIN ${user} u ON u.id=s."userId" LEFT JOIN ${assurance} a ON a.session_id=s.id WHERE s.id=${sessionId} AND s."expiresAt">NOW() AND u.id=${subject} AND u."emailVerified"=true`);
      if (!result.rows.length) return {valid:false};
      const strong=result.rows[0].strong_at;
      return strong === null ? {valid:true} : {valid:true,strongAt:Number(strong)};
    })); },
    socialEmail(provider,accountId) { return run(connection => connection.transaction({...options,readOnly:true},async tx => {
      const result=await tx.execute(sql`SELECT u.email FROM ${account} a JOIN ${user} u ON u.id=a."userId" WHERE a."providerId"=${provider} AND a."accountId"=${accountId} UNION ALL SELECT email FROM ${social} WHERE provider=${provider} AND account_id=${accountId} AND verified=true AND expires_at>NOW() LIMIT 1`);
      return typeof result.rows[0]?.email === "string" ? result.rows[0].email : undefined;
    })); },
    hasSocialProof(proof) { return run(connection => connection.transaction({...options,readOnly:true},async tx => (await tx.execute(sql`SELECT 1 FROM ${social} WHERE proof_hash=${proof} AND expires_at>NOW()`)).rows.length>0)); },
    verifySocialProof(proof,token) { return run(connection => connection.transaction(options,async tx => {
      const result=await tx.execute(sql`UPDATE ${social} SET verified=true,token_hash=NULL,expires_at=NOW()+interval '15 minutes' WHERE proof_hash=${proof} AND token_hash=${token} AND expires_at>NOW() RETURNING provider,linking`);
      const row=result.rows[0]; return row ? {provider:String(row.provider),linking:row.linking===true} : undefined;
    })); },
    setSocialEmail(proof,email,token) { return run(connection => connection.transaction(options,async tx => (await tx.execute(sql`UPDATE ${social} SET email=${email},token_hash=${token},verified=false WHERE proof_hash=${proof} AND expires_at>NOW() RETURNING provider`)).rows.length>0)); },
    createSocialProof(proof,provider,accountId,linking) { return run(connection => connection.transaction(options,async tx => {
      await tx.execute(sql`DELETE FROM ${social} WHERE expires_at<NOW()`);
      await tx.execute(sql`INSERT INTO ${social}(proof_hash,provider,account_id,linking,expires_at) VALUES(${proof},${provider},${accountId},${linking},NOW()+interval '1 hour')`);
    })); },
  };
}
