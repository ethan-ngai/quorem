/** @file fixture.ts @description Normalize bounded newly published runner fixtures. @module judging */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import {
  JsonNumber,
  parseLosslessJson,
  stringifyLosslessJson,
  type JsonValue,
} from "@quorem/questions";
import { fixtureSourceHash } from "./source.ts";
import type { FixtureOwner } from "./bind.ts";

type Obj = { [key: string]: JsonValue };
type Parent = FixtureOwner;
function object(value: JsonValue | undefined): Obj {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof JsonNumber)
    throw new Error("Invalid fixture");
  return value;
}
function list(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}
function wireCase(value: JsonValue): Obj {
  const item = object(value),
    result: Obj = { args: item.args ?? null };
  if (Array.isArray(item.calls) && item.calls.length) result.calls = item.calls;
  if (item.expected !== undefined) result.expected = item.expected;
  return result;
}
/** Canonical execution-only metadata shared with the offline normalizer. */
export function fixtureMetadata(value: JsonValue): Obj {
  const problem = object(value),
    metadata: Obj = {};
  for (const key of ["id", "signature", "constraints", "limits", "sql"])
    if (problem[key] !== undefined && problem[key] !== null) metadata[key] = problem[key];
  if (problem.odyssey !== undefined && problem.odyssey !== null)
    metadata.odyssey = {
      levels: list(object(problem.odyssey).levels).map((level) => ({
        methods: object(level).methods ?? [],
      })),
    };
  return metadata;
}
/** Canonicalize metadata numeric rendering through the authoritative PostgreSQL JSONB representation. */
export async function encodeFixtureMetadata(
  tx: Transaction,
  value: JsonValue,
): Promise<Uint8Array> {
  const raw = stringifyLosslessJson(fixtureMetadata(value));
  const row = (
    await tx.execute<{ canonical: string }>(sql`SELECT ${raw}::jsonb::text AS canonical`)
  ).rows[0];
  return new TextEncoder().encode(stringifyLosslessJson(parseLosslessJson(row.canonical)));
}
/** Canonical case bytes used by publication and the operator backfill. */
export function encodeFixtureCase(value: JsonValue): Uint8Array {
  return new TextEncoder().encode(stringifyLosslessJson(wireCase(value)));
}
export async function storeFixtureBlob(tx: Transaction, bytes: Uint8Array): Promise<Uint8Array> {
  const row = (
    await tx.execute<{ hash: Uint8Array }>(
      sql`WITH input AS (SELECT ${bytes}::bytea AS data), inserted AS (INSERT INTO runner_input_blobs(hash,data) SELECT sha256(data),data FROM input ON CONFLICT(hash) DO NOTHING RETURNING hash) SELECT hash FROM inserted UNION ALL SELECT b.hash FROM runner_input_blobs b,input i WHERE b.hash=sha256(i.data) AND b.data=i.data LIMIT 1`,
    )
  ).rows[0];
  if (!row) throw new Error("Runner input hash collision");
  return row.hash;
}
/** Caller holds the publication or snapshot transaction; previously sealed indexes are immutable. */
export async function indexRunnerFixture(
  tx: Transaction,
  parent: Parent,
  raw: string,
): Promise<void> {
  const root = object(parseLosslessJson(raw)),
    problem = object(root.problem);
  const levels = problem.odyssey ? list(object(problem.odyssey).levels) : [];
  const metadataHash = await storeFixtureBlob(tx, await encodeFixtureMetadata(tx, problem));
  const fixtureHash = await fixtureSourceHash(tx, parent);
  let existing: { sealed: boolean; same: boolean } | undefined;
  if ("version" in parent) {
    existing = (
      await tx.execute<{ sealed: boolean; same: boolean }>(
        sql`SELECT sealed,(metadata_hash=${metadataHash}::bytea AND fixture_hash=${fixtureHash}::bytea) AS same FROM runner_version_inputs WHERE version_id=${parent.version}::uuid`,
      )
    ).rows[0];
    if (existing && (!existing.sealed || !existing.same))
      throw new Error("Conflicting runner fixture");
    if (!existing)
      await tx.execute(
        sql`INSERT INTO runner_version_inputs(version_id,metadata_hash,fixture_hash) VALUES(${parent.version}::uuid,${metadataHash},${fixtureHash})`,
      );
  } else {
    existing = (
      await tx.execute<{ sealed: boolean; same: boolean }>(
        sql`SELECT sealed,(metadata_hash=${metadataHash}::bytea AND fixture_hash=${fixtureHash}::bytea) AS same FROM runner_snapshot_inputs WHERE session_id=${parent.session}::uuid AND fixture_id=${parent.fixture}::bytea`,
      )
    ).rows[0];
    if (existing && (!existing.sealed || !existing.same))
      throw new Error("Conflicting runner fixture");
    if (!existing)
      await tx.execute(
        sql`INSERT INTO runner_snapshot_inputs(session_id,fixture_id,metadata_hash,fixture_hash) VALUES(${parent.session}::uuid,${parent.fixture},${metadataHash},${fixtureHash})`,
      );
  }
  const cases: {
    channel: "example" | "hidden";
    stage: number;
    ordinal: number;
    data: Uint8Array;
  }[] = [];
  const add = (channel: "example" | "hidden", stage: number, values: JsonValue[]) => {
    for (let ordinal = 0; ordinal < values.length; ordinal++)
      cases.push({
        channel,
        stage,
        ordinal,
        data: encodeFixtureCase(values[ordinal]),
      });
  };
  if (levels.length) {
    const suites = list(root.odysseyHiddenCases);
    if (suites.length !== levels.length) throw new Error("Invalid fixture suites");
    for (let i = 0; i < levels.length; i++) {
      add("example", i + 1, list(object(levels[i]).examples));
      add("hidden", i + 1, list(suites[i]));
    }
  } else {
    add("example", 0, list(problem.examples));
    add("hidden", 0, list(root.hiddenCases));
  }
  if (existing) {
    const actual =
      "version" in parent
        ? sql`SELECT c.channel,c.stage,c.ordinal,b.data FROM runner_version_input_cases c JOIN runner_input_blobs b ON b.hash=c.blob_hash WHERE c.version_id=${parent.version}::uuid`
        : sql`SELECT c.channel,c.stage,c.ordinal,b.data FROM runner_snapshot_input_cases c JOIN runner_input_blobs b ON b.hash=c.blob_hash WHERE c.session_id=${parent.session}::uuid AND c.fixture_id=${parent.fixture}::bytea`;
    const expected = cases.length
      ? sql`SELECT * FROM (VALUES ${sql.join(
          cases.map(
            (item) =>
              sql`(${item.channel}::text,${item.stage}::integer,${item.ordinal}::integer,${item.data}::bytea)`,
          ),
          sql`, `,
        )}) AS v(channel,stage,ordinal,data)`
      : sql`SELECT NULL::text AS channel,NULL::integer AS stage,NULL::integer AS ordinal,NULL::bytea AS data WHERE false`;
    const conflict = (
      await tx.execute<{ found: boolean }>(
        sql`WITH expected AS (${expected}),actual AS (${actual}) SELECT EXISTS((SELECT * FROM expected EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)) AS found`,
      )
    ).rows[0];
    if (conflict.found) throw new Error("Conflicting runner fixture");
    return;
  }
  if (cases.length) {
    const rows = sql.join(
      cases.map(
        (item) =>
          sql`(${item.channel}::text,${item.stage}::integer,${item.ordinal}::integer,${item.data}::bytea)`,
      ),
      sql`, `,
    );
    await tx.execute(
      sql`WITH input(channel,stage,ordinal,data) AS (VALUES ${rows}) INSERT INTO runner_input_blobs(hash,data) SELECT DISTINCT sha256(data),data FROM input ON CONFLICT(hash) DO NOTHING`,
    );
    const mismatch = (
      await tx.execute<{ found: boolean }>(
        sql`WITH input(channel,stage,ordinal,data) AS (VALUES ${rows}) SELECT EXISTS(SELECT 1 FROM input i LEFT JOIN runner_input_blobs b ON b.hash=sha256(i.data) WHERE b.hash IS NULL OR b.data<>i.data) AS found`,
      )
    ).rows[0];
    if (mismatch.found) throw new Error("Runner input hash collision");
    if ("version" in parent)
      await tx.execute(
        sql`WITH input(channel,stage,ordinal,data) AS (VALUES ${rows}) INSERT INTO runner_version_input_cases(version_id,channel,stage,ordinal,blob_hash) SELECT ${parent.version}::uuid,channel,stage,ordinal,sha256(data) FROM input`,
      );
    else
      await tx.execute(
        sql`WITH input(channel,stage,ordinal,data) AS (VALUES ${rows}) INSERT INTO runner_snapshot_input_cases(session_id,fixture_id,channel,stage,ordinal,blob_hash) SELECT ${parent.session}::uuid,${parent.fixture}::bytea,channel,stage,ordinal,sha256(data) FROM input`,
      );
  }
  if ("version" in parent)
    await tx.execute(
      sql`UPDATE runner_version_inputs SET sealed=true WHERE version_id=${parent.version}::uuid`,
    );
  else
    await tx.execute(
      sql`UPDATE runner_snapshot_inputs SET sealed=true WHERE session_id=${parent.session}::uuid AND fixture_id=${parent.fixture}`,
    );
}
