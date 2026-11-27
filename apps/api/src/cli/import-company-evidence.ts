/** @file import-company-evidence.ts @description Atomically import a verified company snapshot. @module cli */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { companyEvidenceWindows } from "@quorem/contracts/catalog-filter";
import { Pool } from "pg";
import { z } from "zod";

const stage = z.object({
  source: z.object({
    repository: z.string().regex(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/),
    commit: z.string().regex(/^[0-9a-f]{40}$/),
    snapshotDate: z.iso.date(),
  }),
  issues: z.array(z.unknown()).length(0),
  rows: z
    .array(
      z.object({
        company: z
          .string()
          .min(1)
          .max(80)
          .refine((name) => name === name.trim() && !name.includes(",")),
        leetcodeId: z.number().int().min(1).max(2147483647).nullable(),
        window: z.enum(companyEvidenceWindows),
        frequency: z.number().min(0).max(100),
      }),
    )
    .min(1),
});

const [input] = process.argv.slice(2);
if (!input || !process.env.DATABASE_URL)
  throw new Error(
    "Usage: DATABASE_URL=<operator URL> node import-company-evidence.ts <company-evidence.json>",
  );

const { source, rows } = stage.parse(JSON.parse(await readFile(input, "utf8")));
const observations = rows.flatMap((row) =>
  row.leetcodeId === null
    ? []
    : [
        {
          company: row.company,
          leetcode_id: row.leetcodeId,
          window_rank: companyEvidenceWindows.indexOf(row.window) + 1,
          frequency: row.frequency,
        },
      ],
);
if (!observations.length) throw new Error("No verified company observations");
const sourceUrl = `${source.repository}/tree/${source.commit}`;
const content = JSON.stringify(observations);
const digest = createHash("sha256")
  .update(JSON.stringify([sourceUrl, source.snapshotDate, observations]))
  .digest("hex");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const snapshot = await client.query(
      `INSERT INTO company_question_snapshots(revision,source_url,snapshot_date,content_sha256)
        VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING revision`,
      [source.commit, sourceUrl, source.snapshotDate, digest],
    );
    if (snapshot.rowCount) {
      const names = [...new Set(observations.map(({ company }) => company))].sort();
      await client.query(
        `INSERT INTO companies(name) SELECT unnest($1::text[])
          ON CONFLICT(lower(name)) DO NOTHING`,
        [names],
      );
      await client.query(
        `INSERT INTO company_question_observations(snapshot_revision,company_id,leetcode_id,window_rank,frequency)
          SELECT $1,c.id,o.leetcode_id,o.window_rank,o.frequency
          FROM jsonb_to_recordset($2::jsonb) AS o(company text,leetcode_id integer,window_rank smallint,frequency double precision)
          JOIN companies c ON lower(c.name)=lower(o.company)`,
        [source.commit, content],
      );
    } else {
      const existing = await client.query(
        "SELECT content_sha256 FROM company_question_snapshots WHERE revision=$1",
        [source.commit],
      );
      if (existing.rows[0]?.content_sha256 !== digest)
        throw new Error("Snapshot revision already imported with different content");
    }
    await client.query("COMMIT");
    console.log(
      JSON.stringify({
        revision: source.commit,
        imported: Boolean(snapshot.rowCount),
        observations: observations.length,
        unresolved: rows.length - observations.length,
      }),
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
