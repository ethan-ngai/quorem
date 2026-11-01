/** @file legacy-snapshot.ts @description Canonical snapshot index and sidecar repair. @module interviews */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import { parseLosslessJson } from "@quorem/questions";
import {
  encodeFixtureCase,
  encodeFixtureMetadata,
  storeFixtureBlob,
} from "../../judging/inputs/fixture.ts";
import { fixtureSourceHash } from "../../judging/inputs/source.ts";
import {
  encodeInterviewPrivateCase,
  encodeInterviewPublicCase,
} from "../question/public-examples.ts";
import { openLegacyFixtureRanges } from "./legacy-ranges.ts";
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

async function metadata(
  tx: Transaction,
  session: string,
  fixture: Uint8Array,
): Promise<Uint8Array> {
  const row = (
    await tx.execute<{ data: string }>(sql`SELECT jsonb_build_object(
    'id',p->'id','signature',p->'signature','constraints',p->'constraints','limits',p->'limits','sql',p->'sql',
    'odyssey',CASE WHEN jsonb_typeof(p->'odyssey'->'levels')='array' THEN jsonb_build_object('levels',(SELECT COALESCE(jsonb_agg(jsonb_build_object('methods',level->'methods') ORDER BY n),'[]'::jsonb) FROM jsonb_array_elements(p->'odyssey'->'levels') WITH ORDINALITY l(level,n))) ELSE NULL END
  )::text AS data FROM interview_question_snapshots q CROSS JOIN LATERAL (SELECT q.fixture->'problem' AS p) source WHERE q.session_id=${session}::uuid AND q.id=${fixture}`)
  ).rows[0];
  if (!row) throw new Error("Snapshot unavailable");
  const value = parseLosslessJson(row.data);
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id)
  )
    throw new Error("Invalid legacy problem identity");
  return encodeFixtureMetadata(tx, value);
}

type PublicTarget = { kind: "snapshot"; fixture: Uint8Array } | { kind: "active"; epoch: string };
async function publicStage(
  tx: Transaction,
  session: string,
  stage: number,
  target: PublicTarget,
  cases: readonly {
    start: number;
    length: number;
    channel: "example" | "hidden";
    stage: number;
    ordinal: number;
  }[],
  read: (item: (typeof cases)[number]) => Promise<string>,
): Promise<void> {
  const existing =
    target.kind === "snapshot"
      ? (
          await tx.execute<{ hash: Uint8Array }>(
            sql`SELECT sha256(examples) AS hash FROM interview_snapshot_public_examples WHERE session_id=${session}::uuid AND fixture_id=${target.fixture} AND level=${stage}`,
          )
        ).rows[0]
      : (
          await tx.execute<{ hash: Uint8Array }>(
            sql`SELECT sha256(examples) AS hash FROM interview_public_examples WHERE session_id=${session}::uuid AND question_epoch=${target.epoch}::uuid AND level=${stage}`,
          )
        ).rows[0];
  const hash = createHash("sha256");
  hash.update("[");
  if (!existing) {
    if (target.kind === "snapshot")
      await tx.execute(
        sql`INSERT INTO interview_snapshot_public_examples(session_id,fixture_id,level,examples) VALUES(${session}::uuid,${target.fixture},${stage},convert_to('[','UTF8'))`,
      );
    else
      await tx.execute(
        sql`INSERT INTO interview_public_examples(session_id,question_epoch,level,examples) VALUES(${session}::uuid,${target.epoch}::uuid,${stage},convert_to('[','UTF8'))`,
      );
  }
  let first = true;
  for (const item of cases) {
    const data = encodeInterviewPublicCase(parseLosslessJson(await read(item)));
    if (!first) hash.update(",");
    hash.update(data);
    if (!existing) {
      const prefix = first ? "" : ",";
      if (target.kind === "snapshot")
        await tx.execute(
          sql`UPDATE interview_snapshot_public_examples SET examples=examples||convert_to(${prefix},'UTF8')||${data}::bytea WHERE session_id=${session}::uuid AND fixture_id=${target.fixture} AND level=${stage}`,
        );
      else
        await tx.execute(
          sql`UPDATE interview_public_examples SET examples=examples||convert_to(${prefix},'UTF8')||${data}::bytea WHERE session_id=${session}::uuid AND question_epoch=${target.epoch}::uuid AND level=${stage}`,
        );
    }
    first = false;
  }
  hash.update("]");
  if (existing) {
    if (!same(existing.hash, hash.digest())) throw new Error("Public example conflict");
  } else if (target.kind === "snapshot")
    await tx.execute(
      sql`UPDATE interview_snapshot_public_examples SET examples=examples||convert_to(']','UTF8') WHERE session_id=${session}::uuid AND fixture_id=${target.fixture} AND level=${stage}`,
    );
  else
    await tx.execute(
      sql`UPDATE interview_public_examples SET examples=examples||convert_to(']','UTF8') WHERE session_id=${session}::uuid AND question_epoch=${target.epoch}::uuid AND level=${stage}`,
    );
}

/** Preserve existing snapshot identity and validate every sealed index on retry. */
export async function normalizeSnapshot(
  tx: Transaction,
  session: string,
  fixture: Uint8Array,
  epochs: readonly string[],
  activeEpoch?: string,
): Promise<void> {
  const opened = await openLegacyFixtureRanges(tx, { session, fixture });
  const { stages, cases, suites } = opened.ranges;
  // Historical metadata and captured suite counts can differ; verify exact case IDs below.
  if (stages > 8) throw new Error("Unsupported legacy stage count");
  const shape = (
    await tx.execute<{ total: number; ids: string[]; examples: number[] }>(
      sql`SELECT CASE WHEN q.fixture->'problem'->'odyssey' IS NULL OR q.fixture->'problem'->'odyssey'='null'::jsonb THEN 0 WHEN jsonb_typeof(q.fixture->'problem'->'odyssey'->'levels')='array' AND jsonb_array_length(q.fixture->'problem'->'odyssey'->'levels')>0 THEN jsonb_array_length(q.fixture->'problem'->'odyssey'->'levels') ELSE -1 END AS total,p.private_ids AS ids,ARRAY[jsonb_array_length(CASE WHEN jsonb_typeof(q.fixture->'problem'->'examples')='array' THEN q.fixture->'problem'->'examples' ELSE '[]'::jsonb END)] || ARRAY(SELECT jsonb_array_length(CASE WHEN jsonb_typeof(level->'examples')='array' THEN level->'examples' ELSE '[]'::jsonb END) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(q.fixture->'problem'->'odyssey'->'levels')='array' THEN q.fixture->'problem'->'odyssey'->'levels' ELSE '[]'::jsonb END) WITH ORDINALITY s(level,n) ORDER BY n) AS examples FROM interview_question_snapshots q JOIN interview_snapshot_public p ON p.session_id=q.session_id AND p.fixture_id=q.id WHERE q.session_id=${session}::uuid AND q.id=${fixture}`,
    )
  ).rows[0];
  const sourceIds = cases
    .filter((c) => c.channel === "hidden" && (stages ? c.stage > 0 : c.stage === 0))
    .sort((a, b) => a.stage - b.stage || a.ordinal - b.ordinal)
    .map((c) => (c.stage === 0 ? `hidden:${c.ordinal}` : `level:${c.stage}:case:${c.ordinal}`));
  if (
    !shape ||
    shape.total !== stages ||
    shape.ids.length !== sourceIds.length ||
    shape.ids.some((id, i) => id !== sourceIds[i]) ||
    shape.examples.length !== stages + 1 ||
    shape.examples.some(
      (count, stage) =>
        count !== cases.filter((c) => c.channel === "example" && c.stage === stage).length,
    )
  )
    throw Object.assign(new Error("Legacy fixture shape conflict"), {
      migrationShape: {
        stages,
        suites,
        total: shape?.total,
        ids: shape?.ids.length,
        sourceIds: sourceIds.length,
        examples: shape?.examples,
        sourceExamples: Array.from(
          { length: stages + 1 },
          (_, stage) =>
            cases.filter((item) => item.channel === "example" && item.stage === stage).length,
        ),
      },
    });
  const selected = cases
    .filter((c) => (stages ? c.stage > 0 : c.stage === 0))
    .sort(
      (a, b) => a.channel.localeCompare(b.channel) || a.stage - b.stage || a.ordinal - b.ordinal,
    );
  const meta = await metadata(tx, session, fixture),
    metadataHash = await storeFixtureBlob(tx, meta),
    fixtureHash = await fixtureSourceHash(tx, { session, fixture });
  const prior = (
    await tx.execute<{ sealed: boolean; metadata: Uint8Array; source: Uint8Array }>(
      sql`SELECT sealed,metadata_hash AS metadata,fixture_hash AS source FROM runner_snapshot_inputs WHERE session_id=${session}::uuid AND fixture_id=${fixture}`,
    )
  ).rows[0];
  if (
    prior &&
    (!prior.sealed || !same(prior.metadata, metadataHash) || !same(prior.source, fixtureHash))
  )
    throw new Error("Conflicting snapshot input");
  if (!prior)
    await tx.execute(
      sql`INSERT INTO runner_snapshot_inputs(session_id,fixture_id,metadata_hash,fixture_hash) VALUES(${session}::uuid,${fixture},${metadataHash},${fixtureHash})`,
    );
  const references: { channel: string; stage: number; ordinal: number; hash: Uint8Array }[] = [];
  for (const entry of selected) {
    const value = parseLosslessJson(await opened.readCase(entry));
    const hash = await storeFixtureBlob(tx, encodeFixtureCase(value));
    references.push({ channel: entry.channel, stage: entry.stage, ordinal: entry.ordinal, hash });
    if (!prior)
      await tx.execute(
        sql`INSERT INTO runner_snapshot_input_cases(session_id,fixture_id,channel,stage,ordinal,blob_hash) VALUES(${session}::uuid,${fixture},${entry.channel},${entry.stage},${entry.ordinal},${hash})`,
      );
  }
  if (prior) {
    const rows = (
      await tx.execute<{ channel: string; stage: number; ordinal: number; hash: Uint8Array }>(
        sql`SELECT channel,stage,ordinal,blob_hash AS hash FROM runner_snapshot_input_cases WHERE session_id=${session}::uuid AND fixture_id=${fixture} ORDER BY channel,stage,ordinal`,
      )
    ).rows;
    if (
      rows.length !== references.length ||
      rows.some(
        (v, i) =>
          v.channel !== references[i].channel ||
          v.stage !== references[i].stage ||
          v.ordinal !== references[i].ordinal ||
          !same(v.hash, references[i].hash),
      )
    )
      throw new Error("Conflicting snapshot cases");
  } else
    await tx.execute(
      sql`UPDATE runner_snapshot_inputs SET sealed=true WHERE session_id=${session}::uuid AND fixture_id=${fixture}`,
    );
  for (let stage = 0; stage <= stages; stage++) {
    const examples = cases
      .filter((c) => c.channel === "example" && c.stage === stage)
      .sort((a, b) => a.ordinal - b.ordinal);
    await publicStage(tx, session, stage, { kind: "snapshot", fixture }, examples, (item) =>
      opened.readCase(item),
    );
    if (activeEpoch)
      await publicStage(
        tx,
        session,
        stage,
        { kind: "active", epoch: activeEpoch },
        examples,
        (item) => opened.readCase(item),
      );
  }
  const hidden = selected
    .filter((c) => c.channel === "hidden")
    .sort((a, b) => a.stage - b.stage || a.ordinal - b.ordinal);
  for (let ordinal = 0; ordinal < hidden.length; ordinal++) {
    const item = hidden[ordinal],
      data = encodeInterviewPrivateCase(parseLosslessJson(await opened.readCase(item)));
    const caseId =
      item.stage === 0 ? `hidden:${item.ordinal}` : `level:${item.stage}:case:${item.ordinal}`;
    for (const epoch of epochs) {
      const written = await tx.execute(
        sql`INSERT INTO interview_question_private_cases(session_id,question_epoch,case_id,ordinal,case_data) VALUES(${session}::uuid,${epoch}::uuid,${caseId},${ordinal},${data}) ON CONFLICT(session_id,question_epoch,case_id) DO UPDATE SET case_data=EXCLUDED.case_data WHERE interview_question_private_cases.ordinal=EXCLUDED.ordinal AND interview_question_private_cases.case_data=EXCLUDED.case_data RETURNING case_id`,
      );
      if (!written.rows.length) throw new Error("Private case conflict");
    }
  }
  const expectedIds = hidden.map((item) =>
    item.stage === 0 ? `hidden:${item.ordinal}` : `level:${item.stage}:case:${item.ordinal}`,
  );
  for (const epoch of epochs) {
    const valid = (
      await tx.execute<{ ok: boolean }>(
        sql`SELECT ARRAY(SELECT case_id FROM interview_question_private_cases WHERE session_id=${session}::uuid AND question_epoch=${epoch}::uuid ORDER BY ordinal)=ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(expectedIds)}::jsonb)) AS ok`,
      )
    ).rows[0]?.ok;
    if (!valid) throw new Error("Private case set conflict");
  }
  const publicCount = (
    await tx.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM interview_snapshot_public_examples WHERE session_id=${session}::uuid AND fixture_id=${fixture}`,
    )
  ).rows[0].count;
  if (publicCount !== stages + 1) throw new Error("Public example set conflict");
  if (!(await opened.verify())) throw new Error("Snapshot changed");
}
