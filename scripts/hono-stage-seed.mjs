/** Verify migration-owned seed rows without allowing additional stage data. */
import { readFile } from "node:fs/promises";

export async function verifyFoundationalTopics(client) {
  const migration = await readFile(
    new URL("../apps/api/migrations/085_foundational_topics.sql", import.meta.url),
    "utf8",
  );
  const marker = "INSERT INTO public.foundational_topics(slug, label, aliases) VALUES";
  const start = migration.indexOf(marker);
  if (start < 0) throw new Error("Missing foundational topic seed");
  const insert = migration
    .slice(start)
    .replace(marker, "INSERT INTO pg_temp.stage_foundational_topics(slug, label, aliases) VALUES");
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
