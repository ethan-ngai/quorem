import { expect, it } from "vitest";
import { createNodePool, withNodeConnection } from "@quorem/database/core";
import { activeGrants } from "./active-grants.ts";
import { capabilityRepository } from "./repository.ts";
import { questionAuthoring } from "../problems/authoring/repository.ts";
import { assertRunnerFixture } from "../judging/worker/test-db.ts";

const url = process.env.QUOREM_AUTHORING_TEST_DATABASE_URL;
it.skipIf(!url)(
  "keeps authoring and capabilities aligned and fences grant revocation",
  async () => {
    assertRunnerFixture(url!, ["/quorem_hono_authoring_test"]);
    const pool = createNodePool({
      connectionString: url!,
      max: 4,
      connectionTimeoutMs: 2000,
      idleTimeoutMs: 1000,
      onIdleError: () => {},
    });
    const id = `grants-${crypto.randomUUID()}`;
    const grantId = crypto.randomUUID();
    const run = <T>(fn: Parameters<typeof withNodeConnection<T>>[2]) =>
      withNodeConnection(pool, { lifetimeMs: 15000 }, fn);
    const authoring = questionAuthoring(run, () => undefined);
    const actor = { userId: id, admin: false };
    const check = async (allowed: boolean) => {
      const caps = await run((scope) => capabilityRepository(scope).capabilities(id));
      expect(caps.authorCustomQuestions).toBe(allowed);
      if (allowed) await expect(authoring.list(actor)).resolves.toBeTypeOf("string");
      else await expect(authoring.list(actor)).rejects.toMatchObject({ status: 403 });
    };
    try {
      await pool.query("INSERT INTO users(id,display_name) VALUES($1,'fixture')", [id]);
      await check(false);
      await pool.query(
        "INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason,valid_from) VALUES($1,$2,'questions.custom','manual','test','fixture','test',clock_timestamp()+interval '1 hour')",
        [grantId, id],
      );
      await check(false);
      await pool.query(
        "UPDATE entitlement_grants SET valid_from=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour' WHERE id=$1",
        [grantId],
      );
      await check(false);
      await pool.query(
        "UPDATE entitlement_grants SET expires_at=NULL,revoked_at=clock_timestamp() WHERE id=$1",
        [grantId],
      );
      await check(false);
      await pool.query("UPDATE entitlement_grants SET revoked_at=NULL WHERE id=$1", [grantId]);
      await check(true);
      await pool.query("UPDATE users SET disabled=true WHERE id=$1", [id]);
      await check(false);
      await pool.query("UPDATE users SET disabled=false,kind='guest' WHERE id=$1", [id]);
      await check(false);
      await pool.query("UPDATE users SET kind='account',role='admin' WHERE id=$1", [id]);
      await pool.query("UPDATE entitlement_grants SET revoked_at=clock_timestamp() WHERE id=$1", [
        grantId,
      ]);
      await check(true);
      await pool.query("UPDATE users SET role='user' WHERE id=$1", [id]);
      await pool.query(
        "UPDATE entitlement_grants SET feature='internal',revoked_at=NULL WHERE id=$1",
        [grantId],
      );
      await check(true);

      let release!: () => void, locked!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const reader = run((scope) =>
        scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 3000 }, async (tx) => {
          await activeGrants(tx, id, ["questions.custom"], "share");
          locked();
          await held;
        }),
      );
      await ready;
      const revoke = pool.query(
        "UPDATE entitlement_grants SET revoked_at=clock_timestamp() WHERE id=$1",
        [grantId],
      );
      try {
        expect(
          await Promise.race([
            revoke.then(() => true),
            new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
          ]),
        ).toBe(false);
      } finally {
        release();
        await reader;
      }
      await revoke;
      await check(false);
    } finally {
      await pool.query("DELETE FROM entitlement_grants WHERE user_id=$1", [id]);
      await pool.query("DELETE FROM users WHERE id=$1", [id]);
      await pool.end();
    }
  },
  20000,
);
