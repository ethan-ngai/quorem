/** Verify migration-owned seed rows without allowing additional stage data. */
import { readFile } from "node:fs/promises";

export async function verifyFoundationalTopics(client) {
  const migrations = ["085_foundational_topics.sql", "093_canonical_topics.sql"];
  const seed = await Promise.all(
    migrations.map((name) =>
      readFile(new URL(`../apps/api/migrations/${name}`, import.meta.url), "utf8"),
    ),
  );
  const table = "public.foundational_topics";
  const start = seed[0].indexOf(`INSERT INTO ${table}`);
  if (start < 0) throw new Error("Missing foundational topic seed");
  const insert = [seed[0].slice(start), ...seed.slice(1)]
    .join("\n")
    .replaceAll(table, "pg_temp.stage_foundational_topics");
  await client.query(
    "CREATE TEMP TABLE stage_foundational_topics (LIKE public.foundational_topics) ON COMMIT DROP",
  );
  await client.query(insert);
  return (
    await client.query(`SELECT NOT EXISTS (
    (SELECT slug,label,aliases FROM public.foundational_topics EXCEPT SELECT slug,label,aliases FROM pg_temp.stage_foundational_topics)
    UNION ALL
    (SELECT slug,label,aliases FROM pg_temp.stage_foundational_topics EXCEPT SELECT slug,label,aliases FROM public.foundational_topics)
  ) AS valid`)
  ).rows[0].valid;
}
