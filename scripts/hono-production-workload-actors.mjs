/** Provision revocable, non-admin benchmark identities without changing existing users. */
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { seedProductUser } from "../apps/auth/src/seed-product-user.ts";
import { fixtureSessionCookie } from "../apps/api/src/runtime/composition/fixtures/staged-actor.ts";
const { Pool } = createRequire(new URL("../packages/database/package.json", import.meta.url))("pg");

export async function createProductionBenchmarkActors({
  databaseURL,
  authSecret,
  mode = "production",
}) {
  const url = new URL(databaseURL);
  const production = mode === "production";
  const expectedDatabase = production ? "neondb" : "quorem_hono_benchmark_test";
  if (
    !["production", "local-test"].includes(mode) ||
    !!url.hash ||
    [...url.searchParams.keys()].some((key) => key.toLowerCase() !== "sslmode") ||
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.pathname !== `/${expectedDatabase}` ||
    typeof authSecret !== "string" ||
    authSecret.length < 32 ||
    (production
      ? !url.hostname.endsWith(".neon.tech") || url.search !== "?sslmode=verify-full"
      : !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  )
    throw new Error("Invalid production benchmark authority");
  const pool = new Pool({
    connectionString: url.href,
    max: 2,
    connectionTimeoutMillis: 10000,
    statement_timeout: 5000,
    query_timeout: 10000,
  });
  const actors = [];
  const subjects = [];
  const productIds = [];
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    try {
      await pool.query("UPDATE users SET disabled=true WHERE id=ANY($1::text[])", [productIds]);
      await pool.query('DELETE FROM quorem_auth.session WHERE "userId"=ANY($1::text[])', [
        subjects,
      ]);
      await pool.query('DELETE FROM quorem_auth."user" WHERE id=ANY($1::text[])', [subjects]);
      disposed = true;
    } finally {
      await pool.end();
    }
  };
  try {
    const existing = await pool.query(
      "SELECT current_database()=$1 AND EXISTS(SELECT 1 FROM access_audit WHERE operation_id='bootstrap:operator') AS valid",
      [expectedDatabase],
    );
    if (existing.rows[0]?.valid !== true)
      throw new Error("Production benchmark identity unavailable");
    for (let index = 0; index < 8; index++) {
      const subject = `judge-benchmark-${randomUUID()}`,
        token = randomBytes(32).toString("base64url");
      subjects.push(subject);
      await pool.query(
        'INSERT INTO quorem_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,\'Judging benchmark\',$2,true,clock_timestamp(),clock_timestamp())',
        [subject, `${subject}@example.test`],
      );
      const userId = await seedProductUser(pool, {
        origin: "https://quorem.app",
        subject,
        name: "Judging benchmark",
        admin: false,
        source: "judging-benchmark",
        reference: subject,
      });
      productIds.push(userId);
      await pool.query(
        'INSERT INTO quorem_auth.session(id,token,"userId","expiresAt","createdAt","updatedAt") VALUES($1,$2,$3,clock_timestamp()+interval \'15 minutes\',clock_timestamp(),clock_timestamp())',
        [randomUUID(), token, subject],
      );
      actors.push({
        id: userId,
        cookie: await fixtureSessionCookie("https://quorem.app", authSecret, token),
      });
    }
    return { actors, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
