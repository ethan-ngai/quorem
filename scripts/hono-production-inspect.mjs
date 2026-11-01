/** @file hono-production-inspect.mjs @description Read-only production cutover inventory. @module deployment */
import { createRequire } from "node:module";
import { productionState } from "./hono-production-state.mjs";
const { Client } = createRequire(new URL("../packages/database/package.json", import.meta.url))(
  "pg",
);
try {
  const { states, resource, worker, runtime, databaseURL } = productionState(process.env);
  const client = new Client({
    connectionString: databaseURL,
    connectionTimeoutMillis: 10000,
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
    const runtimeFlags = Object.fromEntries(
      Object.entries(runtime).filter(([key]) =>
        [
          "AUTH_MODE",
          "AUTH_LOGIN_ONLY",
          "AUTH_EMAIL_DRIVER",
          "AUTH_PASSKEYS",
          "AUTH_ORIGIN",
          "PROFILE_STORAGE_DRIVER",
        ].includes(key),
      ),
    );
    const routes = (states.app.resources ?? [])
      .filter((item) => item.type === "cloudflare_workers_route")
      .flatMap((item) =>
        item.instances.map((instance) => ({
          pattern: instance.attributes.pattern,
          script: instance.attributes.script,
        })),
      );
    console.log(
      JSON.stringify({
        worker: worker.name,
        counts,
        migrations,
        jobs,
        photos,
        roles,
        runtimeFlags,
        runtimeKeys: Object.keys(runtime).sort(),
        routes,
        containers: ["container", "judge_container", "fast_judge_container", "case_container"].map(
          (name) => ({ name, id: resource("restapi_object", name)?.id }),
        ),
        secretContinuity: {
          auth: runtime.BETTER_AUTH_SECRET === process.env.BETTER_AUTH_SECRET,
          internal: runtime.AUTH_INTERNAL_SECRET === process.env.AUTH_INTERNAL_SECRET,
          invite: runtime.QUOREM_INVITE_KEY === process.env.QUOREM_INVITE_KEY,
        },
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
      reason: ["Invalid production backend", "Production identity mismatch"].includes(error.message)
        ? error.message
        : undefined,
    }),
  );
  process.exitCode = 1;
}
