import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { drizzleAuthRepository } from "./adapters/drizzle-auth-repository.ts";
import { migrateAuth } from "./migrations.ts";

const url = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!url)("auth repository expiry on disposable PostgreSQL", () => {
  it("checks social proofs, rate windows and session expiry after waiting for locks", async () => {
    const parsed = new URL(url!);
    expect(parsed.port).toBe("55438");
    expect(parsed.pathname).toBe("/quorem_hono_auth_native_test");
    expect(["127.0.0.1", "localhost", "[::1]"]).toContain(parsed.hostname);
    const pool = createNodePool({
      connectionString: url!,
      max: 4,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      onIdleError: () => {},
    });
    const run = <T>(action: Parameters<typeof withNodeConnection<T>>[2]) =>
      withNodeConnection(pool, { lifetimeMs: 10000 }, action);
    const repository = drizzleAuthRepository(run);
    const suffix = randomUUID(),
      proofA = `a${suffix}`,
      proofB = `b${suffix}`,
      user = `user-${suffix}`,
      session = `session-${suffix}`;
    const scope = `fixture-${suffix}`,
      subject = "fixture",
      bucket = createHash("sha256")
        .update(JSON.stringify([scope, subject]))
        .digest("hex");
    const locker = await pool.connect();
    try {
      await migrateAuth(pool);
      await pool.query(
        `INSERT INTO quorem_auth.social_email(proof_hash,provider,account_id,token_hash,expires_at) VALUES ($1,'fixture','a','token-a',clock_timestamp()+interval '300 milliseconds'),($2,'fixture','b','token-b',clock_timestamp()+interval '300 milliseconds')`,
        [proofA, proofB],
      );
      await locker.query("BEGIN");
      await locker.query(
        "SELECT proof_hash FROM quorem_auth.social_email WHERE proof_hash=ANY($1) FOR UPDATE",
        [[proofA, proofB]],
      );
      const verify = repository.verifySocialProof(proofA, "token-a");
      const set = repository.setSocialEmail(proofB, "fixture@example.test", "new-token");
      expect(await Promise.race([verify.then(() => true), delay(80).then(() => false)])).toBe(
        false,
      );
      await delay(400);
      await locker.query("COMMIT");
      expect(await verify).toBeUndefined();
      expect(await set).toBe(false);
      const proofs = await pool.query(
        "SELECT verified,email,token_hash FROM quorem_auth.social_email WHERE proof_hash=ANY($1)",
        [[proofA, proofB]],
      );
      expect(proofs.rows).toEqual([
        { verified: false, email: null, token_hash: "token-a" },
        { verified: false, email: null, token_hash: "token-b" },
      ]);
      await pool.query(
        "INSERT INTO quorem_auth.rate_limit(bucket,used,expires_at) VALUES($1,1,clock_timestamp()-interval '1 second')",
        [bucket],
      );
      await locker.query("BEGIN");
      await locker.query("SELECT bucket FROM quorem_auth.rate_limit WHERE bucket=$1 FOR UPDATE", [
        bucket,
      ]);
      const admission = repository.rateLimit(scope, subject, { limit: 1, seconds: 1 });
      expect(await Promise.race([admission.then(() => true), delay(80).then(() => false)])).toBe(
        false,
      );
      await delay(1100);
      await locker.query("COMMIT");
      expect((await admission).allowed).toBe(true);
      expect((await repository.rateLimit(scope, subject, { limit: 1, seconds: 1 })).allowed).toBe(
        false,
      );
      await pool.query(
        `INSERT INTO quorem_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,'Fixture',$2,true,clock_timestamp(),clock_timestamp())`,
        [user, `${suffix}@example.test`],
      );
      await pool.query(
        `INSERT INTO quorem_auth.session(id,token,"userId","expiresAt","createdAt","updatedAt") VALUES($1,$2,$3,clock_timestamp()+interval '300 milliseconds',clock_timestamp(),clock_timestamp())`,
        [session, suffix, user],
      );
      await locker.query("BEGIN");
      await locker.query("LOCK TABLE quorem_auth.session IN ACCESS EXCLUSIVE MODE");
      const authority = repository.sessionAuthority(session, user);
      expect(await Promise.race([authority.then(() => true), delay(80).then(() => false)])).toBe(
        false,
      );
      await delay(400);
      await locker.query("COMMIT");
      expect(await authority).toEqual({ valid: false });
    } finally {
      await locker.query("ROLLBACK").catch(() => {});
      locker.release();
      await pool.query("DELETE FROM quorem_auth.social_email WHERE proof_hash=ANY($1)", [
        [proofA, proofB],
      ]);
      await pool.query("DELETE FROM quorem_auth.rate_limit WHERE bucket=$1", [bucket]);
      await pool.query('DELETE FROM quorem_auth."user" WHERE id=$1', [user]);
      await pool.end();
    }
  }, 12000);
});
