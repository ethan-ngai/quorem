/** @file publication.ts @description Validated question publication persistence. @module problems */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import {
  JsonNumber,
  publicQuestionProblem,
  type AuthoredQuestionProblem,
  parseLosslessJson,
  stringifyLosslessJson,
  validateQuestionPublication,
  validateQuestionSchema,
  type JsonValue,
  type RuntimeResolver,
} from "@quorem/questions";
import { object, storageProjection } from "./storage.ts";
import { indexRunnerFixture } from "../judging/inputs/fixture.ts";
type Obj = { [key: string]: JsonValue };
const list = (value: JsonValue | undefined): JsonValue[] => (Array.isArray(value) ? value : []);
const str = (value: JsonValue | undefined): string => {
  if (typeof value !== "string") throw new Error("Invalid question content");
  return value;
};
const store = storageProjection;
const content = (raw: string): Obj => object(parseLosslessJson(raw));
function fixture(contentValue: Obj): Obj {
  const authored = object(contentValue.problem);
  const problem = publicQuestionProblem(
    authored as unknown as AuthoredQuestionProblem,
  ) as unknown as Obj;
  const levels = authored.odyssey ? list(object(authored.odyssey).levels) : [];
  const suites = levels.map((level) => object(level).hiddenCases ?? []);
  return {
    problem,
    hiddenCases: contentValue.hiddenCases ?? [],
    odysseyHiddenCases: suites,
    attribution: contentValue.attribution ?? "",
  };
}
function sidecars(c: Obj): {
  safeFixture: string;
  fixture: Uint8Array | null;
  public: Uint8Array | null;
  stages: Uint8Array | null;
} {
  const f = fixture(c),
    p = object(c.problem),
    o = p.odyssey ? object(p.odyssey) : undefined,
    levels = o ? list(o.levels) : [];
  const pub: Obj = {
    problem: {
      examples: p.examples ?? [],
      ...(levels.length
        ? { odyssey: { levels: [{ examples: object(levels[0]).examples ?? [] }] } }
        : {}),
    },
  };
  const staged: Obj = {
    problem: {
      odyssey: { levels: levels.map((level) => ({ examples: object(level).examples ?? [] })) },
    },
  };
  const whole = store(stringifyLosslessJson(f));
  return {
    safeFixture: whole.safe,
    fixture: whole.lossless,
    public: store(stringifyLosslessJson(pub)).lossless,
    stages: levels.length ? store(stringifyLosslessJson(staged)).lossless : null,
  };
}

/** Validates complete content before inserting and sealing a publication. */
export async function persistQuestionPublication(
  tx: Transaction,
  raw: string,
  problemId: string,
  publicationId: string,
  privateOwner: string | null,
  runtime: RuntimeResolver,
  options: { customInterview?: boolean } = {},
): Promise<void> {
  if (options.customInterview && !privateOwner)
    throw new Error("Custom interview question must be private");
  validateQuestionPublication(raw, validateQuestionSchema, runtime, {
    requireCanonicalSource: !options.customInterview,
  });
  const c = content(raw),
    p = object(c.problem);
  if (p.id !== publicationId) throw new Error("Publication identity mismatch");
  const parent = (
    await tx.execute<{ slug: string; owner: string | null }>(
      sql`SELECT slug,owner_id AS owner FROM problems WHERE id=${problemId}::uuid FOR UPDATE`,
    )
  ).rows[0];
  if (!parent || parent.slug !== p.slug || parent.owner !== privateOwner)
    throw new Error("Problem identity mismatch");
  const side = sidecars(c),
    safe = content(side.safeFixture),
    safeProblem = object(safe.problem),
    publicJSON = stringifyLosslessJson(safeProblem);
  await tx.execute(
    sql`INSERT INTO question_publications(id,problem_id,title,difficulty,statement_markdown,signature,constraints,limits,attribution,sql_config,odyssey,lossless_fixture,lossless_public,lossless_stages) SELECT ${publicationId}::uuid,${problemId}::uuid,doc->>'title',doc->>'difficulty',doc->>'statementMarkdown',CASE WHEN doc->'sql' IS NOT NULL OR doc->'odyssey' IS NOT NULL THEN NULL ELSE doc->'signature' END,COALESCE(doc->'constraints','[]'),doc->'limits',${str(c.attribution)},doc->'sql',doc->'odyssey',${side.fixture},${side.public},${side.stages} FROM (SELECT ${publicJSON}::jsonb AS doc) input`,
  );
  const hidden = stringifyLosslessJson(safe.hiddenCases ?? []),
    staged = stringifyLosslessJson(safe.odysseyHiddenCases ?? []);
  await tx.execute(
    sql`INSERT INTO problem_examples(publication_id,ordinal,args,expected,explanation,calls,graphs) SELECT ${publicationId}::uuid,ordinality-1,value->'args',value->'expected',COALESCE(value->>'explanation',''),COALESCE(value->'calls','[]'),value->'graphs' FROM jsonb_array_elements(${publicJSON}::jsonb->'examples') WITH ORDINALITY`,
  );
  await tx.execute(
    sql`INSERT INTO problem_test_cases(publication_id,ordinal,args,expected,calls,graphs) SELECT ${publicationId}::uuid,ordinality-1,value->'args',value->'expected',COALESCE(value->'calls','[]'),value->'graphs' FROM jsonb_array_elements(${hidden}::jsonb) WITH ORDINALITY`,
  );
  await tx.execute(
    sql`INSERT INTO problem_odyssey_cases(publication_id,level,ordinal,case_data) SELECT ${publicationId}::uuid,stage.ordinality-1,c.ordinality-1,c.value FROM jsonb_array_elements(${staged}::jsonb) WITH ORDINALITY stage(value,ordinality),LATERAL jsonb_array_elements(stage.value) WITH ORDINALITY c(value,ordinality)`,
  );
  await tx.execute(
    sql`INSERT INTO problem_tags(publication_id,tag,ordinal) SELECT ${publicationId}::uuid,value,ordinality-1 FROM jsonb_array_elements_text(${publicJSON}::jsonb->'tags') WITH ORDINALITY`,
  );
  await updateQuestionCatalogMetadata(tx, problemId, p, privateOwner);
  await registerArtifacts(tx, c, publicationId);
  await indexRunnerFixture(tx, { publication: publicationId }, stringifyLosslessJson(fixture(c)));
  await tx.execute(
    sql`UPDATE problems SET current_publication_id=${publicationId}::uuid WHERE id=${problemId}::uuid`,
  );
  await tx.execute(
    sql`UPDATE question_publications SET sealed=true WHERE id=${publicationId}::uuid`,
  );
}

/** Synchronize catalog metadata with the current publication. */
async function updateQuestionCatalogMetadata(
  tx: Transaction,
  problemId: string,
  p: Obj,
  privateOwner: string | null,
) {
  if (!privateOwner) {
    const leetcode = p.leetcodeId instanceof JsonNumber ? Number(p.leetcodeId.lexeme) : null;
    await tx.execute(sql`UPDATE problems SET leetcode_id=${leetcode} WHERE id=${problemId}::uuid`);
  }
  await tx.execute(sql`DELETE FROM problem_companies WHERE problem_id=${problemId}::uuid`);
  for (const company of list(p.companies)) {
    const name = str(company);
    await tx.execute(
      sql`INSERT INTO companies(name) VALUES(${name}) ON CONFLICT(lower(name)) DO NOTHING`,
    );
    await tx.execute(
      sql`INSERT INTO problem_companies(problem_id,company_id) SELECT ${problemId}::uuid,id FROM companies WHERE lower(name)=lower(${name})`,
    );
  }
}
async function registerArtifacts(tx: Transaction, c: Obj, publicationId: string): Promise<void> {
  for (const [ordinal, item] of list(c.approaches).entries()) {
    const a = object(item);
    const registered =
      await tx.execute(sql`INSERT INTO problem_solution_approaches AS existing(publication_id,id,ordinal,title,is_canonical,default_language,explanation_markdown,time_complexity,space_complexity,complexity_notes)
      VALUES(${publicationId}::uuid,${str(a.id)},${ordinal},${typeof a.title === "string" ? a.title : ""},${a.id === c.canonicalApproachId},${typeof a.defaultLanguage === "string" ? a.defaultLanguage : null},${str(a.explanationMarkdown)},${str(a.timeComplexity)},${str(a.spaceComplexity)},${str(a.complexityNotes)}) ON CONFLICT(publication_id,id) DO UPDATE SET id=EXCLUDED.id WHERE existing IS NOT DISTINCT FROM EXCLUDED RETURNING id`);
    if (!registered.rows.length) throw new Error("Approach metadata is immutable");
    for (const variant of list(a.implementations)) {
      const v = object(variant);
      const code = await tx.execute(
        sql`INSERT INTO problem_solutions(publication_id,approach_id,language,source) VALUES(${publicationId}::uuid,${str(a.id)},${str(v.language)},${str(v.source)}) ON CONFLICT(publication_id,approach_id,language) DO UPDATE SET source=EXCLUDED.source WHERE problem_solutions.source=EXCLUDED.source RETURNING language`,
      );
      if (!code.rows.length) throw new Error("Approach code is immutable");
    }
  }
}
/** Resume an interrupted fixed fixture installation without changing existing content. */
export async function resumeQuestionPublication(
  tx: Transaction,
  raw: string,
  publicationId: string,
  runtime: RuntimeResolver,
): Promise<void> {
  validateQuestionPublication(raw, validateQuestionSchema, runtime);
  const c = content(raw),
    p = object(c.problem);
  if (p.id !== publicationId) throw new Error("Publication identity mismatch");
  const current = (
    await tx.execute<{ slug: string }>(
      sql`SELECT p.slug FROM question_publications v JOIN problems p ON p.id=v.problem_id WHERE v.id=${publicationId}::uuid FOR UPDATE OF v`,
    )
  ).rows[0];
  if (!current || current.slug !== p.slug) throw new Error("Publication identity mismatch");
  await registerArtifacts(tx, c, publicationId);
  await indexRunnerFixture(tx, { publication: publicationId }, stringifyLosslessJson(fixture(c)));
  await tx.execute(
    sql`UPDATE question_publications SET sealed=true WHERE id=${publicationId}::uuid AND NOT sealed`,
  );
}
