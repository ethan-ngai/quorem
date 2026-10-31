/** @file published-sidecars.ts @description Lossless public example and private case projection. @module interviews */
import { sql, type SQL } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import { StreamingJsonReader, decodeUtf8Chunks } from "@quorem/questions";

type Range = { start: number; length: number };
type Field = { name: string; range?: Range; calls?: Field[][] | null };
type Example = Field[];
const exampleKeys = new Set(["args", "expected", "calls", "explanation"]);
const callKeys = new Set(["methodName", "args", "expected"]);

async function skip(reader: StreamingJsonReader): Promise<Range> {
  await reader.peek();
  const start = reader.byteOffset;
  for await (const _ of reader.valueChunks()) {
    /* retain offsets only */
  }
  return { start, length: reader.byteOffset - start };
}
async function key(reader: StreamingJsonReader): Promise<string | undefined> {
  let encoded = "";
  for await (const part of reader.valueChunks()) if (encoded.length <= 512) encoded += part;
  if (encoded.length > 512) return undefined;
  const value: unknown = JSON.parse(encoded);
  if (typeof value !== "string") throw new Error("Invalid public example key");
  return value;
}
async function fields(
  reader: StreamingJsonReader,
  visit: (name: string | undefined) => Promise<void>,
) {
  await reader.expect("{");
  if ((await reader.peek()) !== "}")
    for (;;) {
      const name = await key(reader);
      await reader.expect(":");
      await visit(name);
      if ((await reader.peek()) === "}") break;
      await reader.expect(",");
      if ((await reader.peek()) === "}") throw new Error("Invalid object");
    }
  await reader.expect("}");
}
async function array(reader: StreamingJsonReader, visit: (index: number) => Promise<void>) {
  await reader.expect("[");
  if ((await reader.peek()) !== "]")
    for (let n = 0; ; n++) {
      await visit(n);
      if ((await reader.peek()) === "]") break;
      await reader.expect(",");
      if ((await reader.peek()) === "]") throw new Error("Invalid array");
    }
  await reader.expect("]");
}
async function projected(reader: StreamingJsonReader, calls: boolean): Promise<Field[]> {
  const result: Field[] = [],
    seen = new Set<string>();
  const allowed = calls ? callKeys : exampleKeys;
  await fields(reader, async (name) => {
    if (!name || !allowed.has(name)) {
      await skip(reader);
      return;
    }
    if (seen.has(name)) throw new Error("Duplicate public example field");
    seen.add(name);
    if (!calls && name === "calls") {
      if ((await reader.peek()) === "n") {
        const value = await reader.value();
        if (value !== "null") throw new Error("Invalid calls");
        result.push({ name, calls: null });
      } else {
        const entries: Field[][] = [];
        await array(reader, async () => {
          entries.push(await projected(reader, true));
        });
        result.push({ name, calls: entries });
      }
    } else result.push({ name, range: await skip(reader) });
  });
  return result;
}
async function examples(reader: StreamingJsonReader): Promise<Example[]> {
  const result: Example[] = [];
  if ((await reader.peek()) === "n") {
    if ((await reader.value()) !== "null") throw new Error("Invalid examples");
    return result;
  }
  await array(reader, async () => {
    result.push(await projected(reader, false));
  });
  return result;
}
/** Scan only 047 public bytes; values and private fixtures never accumulate in the Worker. */
async function scan(reader: StreamingJsonReader): Promise<Map<number, Example[]>> {
  const result = new Map<number, Example[]>();
  await fields(reader, async (outer) => {
    if (outer !== "problem") {
      await skip(reader);
      return;
    }
    await fields(reader, async (name) => {
      if (name === "examples") result.set(0, await examples(reader));
      else if (name === "odyssey")
        await fields(reader, async (odysseyKey) => {
          if (odysseyKey !== "levels") {
            await skip(reader);
            return;
          }
          await array(reader, async (stage) =>
            fields(reader, async (field) => {
              if (field === "examples") result.set(stage + 1, await examples(reader));
              else await skip(reader);
            }),
          );
        });
      else await skip(reader);
    });
  });
  if (await reader.peek()) throw new Error("Trailing public example data");
  return result;
}
const bytes = (value: string): SQL => sql`convert_to(${value},'UTF8')`;
function fragments(value: Field[], source: SQL): SQL {
  const entries = value.map((field) => {
    const body = field.range
      ? sql`substring(${source} FROM ${field.range.start + 1} FOR ${field.range.length})`
      : field.calls === null
        ? bytes("[]")
        : values(field.calls ?? [], source);
    return sql`${bytes(JSON.stringify(field.name) + ":")} || ${body}`;
  });
  return entries.length
    ? sql`${bytes("{")} || ${sql.join(entries, sql` || ${bytes(",")} || `)} || ${bytes("}")}`
    : bytes("{}");
}
function values(cases: Field[][], source: SQL): SQL {
  const items = cases.map((value) => fragments(value, source));
  return items.length
    ? sql`${bytes("[")} || ${sql.join(items, sql` || ${bytes(",")} || `)} || ${bytes("]")}`
    : bytes("[]");
}
function safeExample(value: SQL): SQL {
  return sql`(SELECT COALESCE(jsonb_object_agg(f.key,CASE WHEN f.key='calls' THEN CASE WHEN jsonb_typeof(f.value)='array' THEN (SELECT COALESCE(jsonb_agg((SELECT COALESCE(jsonb_object_agg(c.key,c.value),'{}'::jsonb) FROM jsonb_each(call) c WHERE c.key IN ('methodName','args','expected')) ORDER BY n),'[]'::jsonb) FROM jsonb_array_elements(f.value) WITH ORDINALITY x(call,n)) ELSE '[]'::jsonb END ELSE f.value END),'{}'::jsonb) FROM jsonb_each(${value}) f WHERE f.key IN ('args','expected','calls','explanation'))`;
}
async function scanColumn(tx: Transaction, versionId: string, source: "public" | "stages") {
  const column = source === "public" ? sql`lossless_public` : sql`lossless_stages`;
  const present = (
    await tx.execute<{ present: boolean }>(
      sql`SELECT COALESCE(octet_length(${column})>0,false) AS present FROM problem_versions WHERE id=${versionId}::uuid`,
    )
  ).rows[0]?.present;
  if (!present) return undefined;
  async function* pages() {
    for (let offset = 1; ; offset += 65536) {
      const row = (
        await tx.execute<{ part: Uint8Array }>(
          sql`SELECT substring(${column} FROM ${offset} FOR 65536) AS part FROM problem_versions WHERE id=${versionId}::uuid`,
        )
      ).rows[0];
      if (!row || !row.part.length) break;
      yield row.part;
      if (row.part.length < 65536) break;
    }
  }
  return scan(new StreamingJsonReader(decodeUtf8Chunks(pages())[Symbol.asyncIterator]()));
}
/** The version lock and authorization are held by the canonical question writer. */
export async function savePublishedInterviewSidecars(
  tx: Transaction,
  id: string,
  epoch: string,
  versionId: string,
): Promise<void> {
  const pub = await scanColumn(tx, versionId, "public"),
    stages = await scanColumn(tx, versionId, "stages");
  const count = (
    await tx.execute<{ total: number }>(
      sql`SELECT CASE WHEN jsonb_typeof(odyssey->'levels')='array' THEN jsonb_array_length(odyssey->'levels') ELSE 0 END AS total FROM problem_versions WHERE id=${versionId}::uuid`,
    )
  ).rows[0]?.total;
  if (count === undefined) throw new Error("Question unavailable");
  for (let level = 0; level <= count; level++) {
    const side = level === 0 ? pub?.get(0) : stages?.get(level);
    if (side !== undefined) {
      const column = level === 0 ? sql`v.lossless_public` : sql`v.lossless_stages`;
      const projected = values(side, column);
      const firstStage = level === 0 && count > 0 ? stages?.get(1) : undefined;
      const data = firstStage
        ? sql`CASE WHEN ${projected} = ${values(firstStage, sql`v.lossless_stages`)} THEN ${bytes("[]")} ELSE ${projected} END`
        : projected;
      await tx.execute(
        sql`INSERT INTO interview_public_examples(session_id,question_epoch,level,examples) SELECT ${id}::uuid,${epoch}::uuid,${level},${data} FROM problem_versions v WHERE v.id=${versionId}::uuid`,
      );
    } else if (level === 0) {
      await tx.execute(
        sql`INSERT INTO interview_public_examples(session_id,question_epoch,level,examples) SELECT ${id}::uuid,${epoch}::uuid,0,convert_to(CASE WHEN v.odyssey IS NOT NULL AND ${stages === undefined} AND e.examples=v.odyssey->'levels'->0->'examples' THEN '[]' ELSE e.examples::text END,'UTF8') FROM problem_versions v CROSS JOIN LATERAL (SELECT COALESCE(jsonb_agg(jsonb_build_object('args',args,'expected',expected,'explanation',explanation,'calls',calls) ORDER BY ordinal),'[]'::jsonb) AS examples FROM problem_examples WHERE version_id=v.id) e WHERE v.id=${versionId}::uuid`,
      );
    } else {
      const projection = safeExample(sql`entry`);
      await tx.execute(
        sql`INSERT INTO interview_public_examples(session_id,question_epoch,level,examples) SELECT ${id}::uuid,${epoch}::uuid,${level},convert_to(COALESCE((SELECT jsonb_agg(${projection} ORDER BY n) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v.odyssey->'levels'->(${level}::int-1)->'examples')='array' THEN v.odyssey->'levels'->(${level}::int-1)->'examples' ELSE '[]'::jsonb END) WITH ORDINALITY x(entry,n)),'[]'::jsonb)::text,'UTF8') FROM problem_versions v WHERE v.id=${versionId}::uuid`,
      );
    }
  }
  await tx.execute(
    sql`INSERT INTO interview_question_private_cases(session_id,question_epoch,case_id,ordinal,case_data) SELECT ${id}::uuid,${epoch}::uuid,CASE WHEN stage=0 THEN 'hidden:'||ordinal::text ELSE 'level:'||stage::text||':case:'||ordinal::text END,(row_number() OVER (ORDER BY stage,ordinal)-1)::int,b.data FROM runner_version_input_cases c JOIN runner_input_blobs b ON b.hash=c.blob_hash WHERE c.version_id=${versionId}::uuid AND c.channel='hidden'`,
  );
}
/** Bind already-projected public examples to the immutable snapshot in the same transaction. */
export async function copySnapshotExamples(
  tx: Transaction,
  id: string,
  epoch: string,
  fixtureId: Uint8Array,
): Promise<void> {
  const row = (
    await tx.execute<{ expected: string; actual: string }>(
      sql`WITH source AS (SELECT level,examples FROM interview_public_examples WHERE session_id=${id}::uuid AND question_epoch=${epoch}::uuid), copied AS (INSERT INTO interview_snapshot_public_examples(session_id,fixture_id,level,examples) SELECT ${id}::uuid,${fixtureId},level,examples FROM source ON CONFLICT(session_id,fixture_id,level) DO UPDATE SET examples=EXCLUDED.examples WHERE interview_snapshot_public_examples.examples=EXCLUDED.examples RETURNING level) SELECT (SELECT count(*)::text FROM source) AS expected,(SELECT count(*)::text FROM copied) AS actual`,
    )
  ).rows[0];
  if (!row || row.expected === "0" || row.expected !== row.actual)
    throw new Error("Snapshot example conflict");
}
