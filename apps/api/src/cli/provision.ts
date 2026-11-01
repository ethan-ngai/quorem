/** @file provision.ts @description Product migration and explicit operator provisioning. @module cli */
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../../", import.meta.url));
import { createNodePool } from "@quorem/database/core";
import { migrate } from "@quorem/database/migrations";

export async function provision(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: { seed: { type: "boolean", default: false }, "private-question": { type: "string" } },
  });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const pool = createNodePool({
    connectionString: url,
    max: 3,
    connectionTimeoutMs: 5000,
    idleTimeoutMs: 5000,
    onIdleError: () => {},
  });
  try {
    await migrate(pool, "product", resolve(root, "apps/api/migrations"));
    if (values.seed) {
      if (!process.env.AUTH_ORIGIN) throw new Error("Verified operator issuer required");
      const actor = (
        await pool.query<{ user_id: string }>(
          `SELECT b.user_id FROM access_audit seed JOIN identity_bindings b ON b.user_id=seed.user_id AND b.subject=seed.scope JOIN quorem_auth."user" a ON a.id=b.subject JOIN users u ON u.id=b.user_id WHERE seed.operation_id='bootstrap:operator' AND b.issuer=$1 AND a."emailVerified" AND u.role='admin' AND NOT u.disabled`,
          [process.env.AUTH_ORIGIN ?? ""],
        )
      ).rows[0];
      if (!actor) throw new Error("Verified operator binding required");
      const { seedCatalog } = await import("./seed.ts");
      const { seedQuestion } = await import("./seed-question.ts");
      await seedCatalog(pool, false);
      await seedQuestion(
        pool,
        actor.user_id,
        "global",
        resolve(root, "fixtures/odyssey/balance-ledger.json"),
      );
      if (values["private-question"])
        await seedQuestion(pool, actor.user_id, "private", resolve(values["private-question"]));
    }
  } finally {
    await pool.end();
  }
}
if (import.meta.main)
  try {
    await provision(process.argv.slice(2));
  } catch {
    console.error("Provision failed");
    process.exitCode = 1;
  }
