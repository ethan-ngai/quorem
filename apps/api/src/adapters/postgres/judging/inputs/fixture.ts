/** @file fixture.ts @description Normalize bounded newly published runner fixtures. @module judging */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import {
  JsonNumber,
  parseLosslessJson,
  stringifyLosslessJson,
  type JsonValue,
} from "@quorem/questions";

type Obj = { [key: string]: JsonValue };
type Parent = { version: string } | { session: string; fixture: Uint8Array };
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
async function blob(tx: Transaction, value: JsonValue): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(stringifyLosslessJson(value));
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
  const metadata: Obj = { ...problem };
  delete metadata.examples;
  if (problem.odyssey)
    metadata.odyssey = {
      ...object(problem.odyssey),
      levels: levels.map((level) => {
        const copy = { ...object(level) };
        delete copy.examples;
        return copy;
      }),
    };
  const metadataHash = await blob(tx, metadata);
  const fixtureHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stringifyLosslessJson(root))),
  );
  if ("version" in parent) {
    const existing = (
      await tx.execute<{ sealed: boolean; same: boolean }>(
        sql`SELECT sealed,(metadata_hash=${metadataHash}::bytea AND fixture_hash=${fixtureHash}::bytea) AS same FROM runner_version_inputs WHERE version_id=${parent.version}::uuid`,
      )
    ).rows[0];
    if (existing) {
      if (!existing.sealed || !existing.same) throw new Error("Conflicting runner fixture");
      return;
    }
    await tx.execute(
      sql`INSERT INTO runner_version_inputs(version_id,metadata_hash,fixture_hash) VALUES(${parent.version}::uuid,${metadataHash},${fixtureHash})`,
    );
  } else {
    const existing = (
      await tx.execute<{ sealed: boolean; same: boolean }>(
        sql`SELECT sealed,(metadata_hash=${metadataHash}::bytea AND fixture_hash=${fixtureHash}::bytea) AS same FROM runner_snapshot_inputs WHERE session_id=${parent.session}::uuid AND fixture_id=${parent.fixture}::bytea`,
      )
    ).rows[0];
    if (existing) {
      if (!existing.sealed || !existing.same) throw new Error("Conflicting runner fixture");
      return;
    }
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
        data: new TextEncoder().encode(stringifyLosslessJson(wireCase(values[ordinal]))),
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
