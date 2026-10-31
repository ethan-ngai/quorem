/** @file staged-actor.ts @description Short-lived synthetic stage identity. @module runtime */
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createNodePool } from "@quorem/database/core";
import { seedCatalog } from "../../../cli/seed.ts";

const version = "e91ec728-4597-5dfb-9d19-7c4ba17138b7";
const acceptedSource =
  "class Solution:\n def runWidths(self, values):\n  result=[]\n  for value in values:\n   if not result or value != previous: result.append(1)\n   else: result[-1]+=1\n   previous=value\n  return result\n";
type Mode = "stage" | "local-test";
export function assertStageDatabase(value: string, mode: Mode): void {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (mode !== "stage" && mode !== "local-test") throw new Error("Invalid stage fixture mode");
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hash ||
    url.pathname !==
      (mode === "stage" ? "/quorem_hono_stage" : "/quorem_hono_stage_fixture_test") ||
    [...url.searchParams.keys()].some((key) =>
      ["host", "hostaddr", "service"].includes(key.toLowerCase()),
    ) ||
    (mode === "local-test" && !loopback) ||
    (!loopback &&
      ([...url.searchParams.keys()].filter((key) => key.toLowerCase() === "sslmode").length !== 1 ||
        url.searchParams.get("sslmode") !== "verify-full" ||
        [...url.searchParams.keys()].some((key) => key.toLowerCase() === "ssl")))
  )
    throw new Error("Invalid stage fixture database");
}

/** Requires the workflow to have applied both complete migration histories first. */
export async function createStagedActor(options: {
  databaseURL: string;
  authOrigin: string;
  authSecret: string;
  mode: Mode;
}) {
  assertStageDatabase(options.databaseURL, options.mode);
  const origin = new URL(options.authOrigin);
  if (
    origin.origin !== options.authOrigin ||
    (origin.protocol !== "https:" &&
      !(
        options.mode === "local-test" &&
        origin.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
      )) ||
    options.authSecret.length < 32
  )
    throw new Error("Invalid stage fixture auth configuration");
  const pool = createNodePool({
    connectionString: options.databaseURL,
    max: 2,
    connectionTimeoutMs: 5000,
    idleTimeoutMs: 5000,
    onIdleError: () => {},
  });
  const id = `stage-fixture-${randomUUID()}`;
  const session = randomUUID(),
    token = randomBytes(32).toString("base64url");
  try {
    const expectedDatabase =
      options.mode === "stage" ? "quorem_hono_stage" : "quorem_hono_stage_fixture_test";
    if ((await pool.query("SELECT current_database() AS name")).rows[0].name !== expectedDatabase)
      throw new Error("Invalid stage fixture database");
    for (const [directory, ledger] of [
      [new URL("../../../../migrations/", import.meta.url), "public.schema_migrations"],
      [
        new URL("../../../../../auth/migrations/", import.meta.url),
        "quorem_auth.schema_migrations",
      ],
    ] as const) {
      const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
      const rows = (await pool.query(`SELECT name FROM ${ledger} ORDER BY name`)).rows.map(
        (row: { name: string }) => row.name,
      );
      if (!files.length || JSON.stringify(files) !== JSON.stringify(rows))
        throw new Error("Stage migrations are incomplete");
    }
    await seedCatalog(pool, false);
    const authRequire = createRequire(
      fileURLToPath(new URL("../../../../../auth/package.json", import.meta.url)),
    );
    const cookiesFile = authRequire.resolve("better-auth/cookies");
    const { getCookies } = await import(pathToFileURL(cookiesFile).href);
    const { serializeSignedCookie } = createRequire(cookiesFile)("better-call") as {
      serializeSignedCookie(
        this: void,
        name: string,
        value: string,
        secret: string,
      ): Promise<string>;
    };
    const name = getCookies({
      baseURL: options.authOrigin,
      advanced: { useSecureCookies: origin.protocol === "https:" },
    }).sessionToken.name as string;
    const sessionCookie = (await serializeSignedCookie(name, token, options.authSecret)).split(
      ";",
    )[0];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        'INSERT INTO quorem_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,true,clock_timestamp(),clock_timestamp())',
        [id, `${id}@example.test`],
      );
      await client.query(
        'INSERT INTO quorem_auth."session"(id,token,"userId","expiresAt","createdAt","updatedAt") VALUES($1,$2,$3,clock_timestamp()+interval \'30 minutes\',clock_timestamp(),clock_timestamp())',
        [session, token, id],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    let disposed = false;
    return {
      sessionCookie,
      problemVersionId: version,
      acceptedSource,
      language: "python" as const,
      async dispose() {
        if (disposed) return;
        try {
          await pool.query('DELETE FROM quorem_auth."session" WHERE id=$1 AND "userId"=$2', [
            session,
            id,
          ]);
          disposed = true;
        } finally {
          if (disposed) await pool.end();
        }
      },
    };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
