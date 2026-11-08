/** @file hono-production-inspect.mjs @description Read-only inventory of the active production deployment. @module deployment */
import { createRequire } from "node:module";
import { z } from "zod";
import { activeProduction } from "./hono-production-state.mjs";
const { Client } = createRequire(new URL("../packages/database/package.json", import.meta.url))(
  "pg",
);
const worker = "quorem-hono-production";
const settingsSchema = z.object({
  result: z.object({
    bindings: z.array(
      z.object({ name: z.string(), type: z.string(), text: z.string().optional() }),
    ),
  }),
});
const publicFlags = [
  "AUTH_MODE",
  "AUTH_LOGIN_ONLY",
  "AUTH_EMAIL_DRIVER",
  "AUTH_PASSKEYS",
  "AUTH_ORIGIN",
  "PROFILE_STORAGE_DRIVER",
];
try {
  const { database } = activeProduction(process.env);
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${worker}/settings`,
    {
      headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Native Worker settings unavailable");
  }
  const settings = settingsSchema.safeParse(await response.json());
  if (!settings.success) throw new Error("Native Worker settings unavailable");
  const bindings = settings.data.result.bindings;
  const runtime = new Map(
    bindings.filter(({ type }) => type === "plain_text").map(({ name, text }) => [name, text]),
  );
  if (
    runtime.get("APP_ENV") !== "production" ||
    runtime.get("AUTH_ORIGIN") !== "https://quorem.app"
  )
    throw new Error("Unexpected production Worker");
  database.search = "?sslmode=verify-full";
  const client = new Client({
    connectionString: database.href,
    connectionTimeoutMillis: 5000,
    query_timeout: 15000,
  });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const counts = {};
    for (const table of [
      "public.users",
      "public.problems",
      "public.problem_versions",
      "public.workspaces",
      "public.submissions",
      "public.execution_jobs",
      "public.matches",
      "public.interviews",
      "quorem_auth.user",
      "quorem_auth.session",
      "quorem_auth.account",
      "quorem_auth.jwks",
    ]) {
      if (!(await client.query("SELECT to_regclass($1) AS name", [table])).rows[0].name) continue;
      const target = table
        .split(".")
        .map((part) => `"${part}"`)
        .join(".");
      counts[table] = Number((await client.query(`SELECT count(*) FROM ${target}`)).rows[0].count);
    }
    const migrations = {};
    for (const namespace of ["public", "quorem_auth"]) {
      migrations[namespace] = {
        columns: (
          await client.query(
            "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='schema_migrations' ORDER BY ordinal_position",
            [namespace],
          )
        ).rows.map((row) => row.column_name),
        names: (
          await client.query(`SELECT name FROM ${namespace}.schema_migrations ORDER BY name`)
        ).rows.map((row) => row.name),
      };
    }
    const jobs = (
      await client.query(
        "SELECT finished,count(*)::int AS count FROM execution_jobs GROUP BY finished ORDER BY finished",
      )
    ).rows;
    const photos = (
      await client.query(
        "SELECT count(*)::int AS referenced FROM quorem_auth.\"user\" WHERE image IS NOT NULL AND image<>''",
      )
    ).rows[0];
    const roles = (
      await client.query(
        "SELECT current_user AS operator,pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=current_database()",
      )
    ).rows[0];
    console.log(
      JSON.stringify({
        worker,
        database: database.pathname.slice(1),
        counts,
        migrations,
        jobs,
        photos,
        roles,
        runtimeFlags: Object.fromEntries(publicFlags.map((name) => [name, runtime.get(name)])),
        bindings: bindings.map(({ name, type }) => ({ name, type })),
      }),
    );
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }
} catch (error) {
  console.error(
    JSON.stringify({
      error: "production-inspection-failed",
      code: /^[A-Z0-9]{5}$/.test(error?.code ?? "") ? error.code : undefined,
      reason: [
        "Invalid Terraform backend identity",
        "Native production state is not active",
        "Unexpected production database",
        "Native Worker settings unavailable",
        "Unexpected production Worker",
      ].includes(error.message)
        ? error.message
        : undefined,
    }),
  );
  process.exitCode = 1;
}
