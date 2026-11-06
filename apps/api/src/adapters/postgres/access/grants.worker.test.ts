/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withWorkerConnection, type ConnectionScope } from "@quorem/database/core";
import { assertRunnerFixture } from "../judging/worker/test-db.ts";
import { capabilityRepository } from "./repository.ts";
import { questionAuthoring } from "../problems/authoring/repository.ts";

const url = (env as unknown as { AUTHORING_TEST_DATABASE_URL: string }).AUTHORING_TEST_DATABASE_URL;
it.skipIf(!url)("authorizes both consumers using worker connections", async () => {
  assertRunnerFixture(url, ["/quorem_hono_authoring_test"]);
  const user = `worker-grants-${crypto.randomUUID()}`;
  const run = <T>(action: (scope: ConnectionScope) => Promise<T>) =>
    withWorkerConnection(url, { connectionTimeoutMs: 1000, lifetimeMs: 10000 }, action);
  const execute = (action: (tx: import("@quorem/database/core").Transaction) => Promise<unknown>) =>
    run((scope) => scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 2000 }, action));
  const authoring = questionAuthoring(run, () => undefined);
  try {
    await execute(async (tx) => {
      await tx.execute(sql`INSERT INTO users(id,display_name) VALUES(${user},'fixture')`);
      await tx.execute(
        sql`INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES(${crypto.randomUUID()}::uuid,${user},'internal','manual','fixture','fixture','fixture')`,
      );
    });
    expect(
      (await run((scope) => capabilityRepository(scope).capabilities(user))).authorCustomQuestions,
    ).toBe(true);
    await expect(authoring.list({ userId: user, admin: false })).resolves.toBeTypeOf("string");
    await execute(async (tx) => {
      await tx.execute(
        sql`UPDATE entitlement_grants SET revoked_at=clock_timestamp() WHERE user_id=${user}`,
      );
    });
    expect(
      (await run((scope) => capabilityRepository(scope).capabilities(user))).authorCustomQuestions,
    ).toBe(false);
    await expect(authoring.list({ userId: user, admin: false })).rejects.toMatchObject({
      status: 403,
    });
  } finally {
    await execute(async (tx) => {
      await tx.execute(sql`DELETE FROM entitlement_grants WHERE user_id=${user}`);
      await tx.execute(sql`DELETE FROM users WHERE id=${user}`);
    });
  }
});
