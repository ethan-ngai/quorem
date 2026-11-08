/** Verify migration-owned seed rows without allowing additional stage data. */
import { readFile } from "node:fs/promises";

const catalogSeeds = {
  foundational_topics: [
    ["085_foundational_topics.sql", "INSERT"],
    ["093_canonical_topics.sql", "INSERT"],
    ["094_demote_arrays.sql", "UPDATE"],
  ],
  company_tiers: [["095_company_tiers.sql", "INSERT"]],
};

export async function verifyCatalogSeed(client, name) {
  if (!Object.hasOwn(catalogSeeds, name)) return undefined;
  const table = `public.${name}`;
  const fixture = `pg_temp.stage_${name}`;
  const seed = await Promise.all(
    catalogSeeds[name].map(async ([migration, statement]) => {
      const source = await readFile(
        new URL(`../apps/api/migrations/${migration}`, import.meta.url),
        "utf8",
      );
      const start = source.indexOf(`${statement} ${statement === "INSERT" ? "INTO " : ""}${table}`);
      if (start < 0) throw new Error(`Missing seed in ${migration}`);
      return source.slice(start).replaceAll(table, fixture);
    }),
  );
  await client.query(
    `CREATE TEMP TABLE ${fixture} (LIKE ${table} INCLUDING DEFAULTS) ON COMMIT DROP`,
  );
  await client.query(seed.join("\n"));
  return (
    await client.query(`SELECT NOT EXISTS (
      (TABLE ${table} EXCEPT TABLE ${fixture})
      UNION ALL
      (TABLE ${fixture} EXCEPT TABLE ${table})
    ) AS valid`)
  ).rows[0].valid;
}
