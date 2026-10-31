/** @file custom.ts @description Canonical private interview question construction. @module interviews */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import { defaultLimits, languageRuntime } from "@quorem/execution";
import {
  generateStarter,
  parseLosslessJson,
  stringifyLosslessJson,
  validateQuestionDefinition,
  validateQuestionSchema,
  type JsonValue,
  type Signature,
  type StarterLanguage,
} from "@quorem/questions";
import { ApplicationError } from "../../../../application/error.ts";
import type { Principal } from "../../../../modules/identity/model.ts";
import { capabilitiesInTransaction } from "../../access/repository.ts";
import { object, storageProjection } from "../../problems/storage.ts";
import { persistQuestionVersion } from "../../problems/publication.ts";
import type { PreparedQuestion } from "../lifecycle/repository.ts";
type Obj = { [key: string]: JsonValue };
const bad = (m: string) => new ApplicationError("invalid_input", m, 400);
const values = (v: JsonValue | undefined): JsonValue[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw bad("Invalid test cases");
  return v;
};
const string = (v: JsonValue | undefined): string => {
  if (typeof v !== "string") throw bad("Invalid custom question");
  return v;
};
/** Build and validate the same question content used by authoring and publication. */
export async function prepareCustomInterviewQuestion(
  tx: Transaction,
  actor: Principal,
  custom: Obj,
  language: string,
  fingerprint: string,
): Promise<PreparedQuestion> {
  if (
    Object.keys(custom).some(
      (key) =>
        ![
          "odyssey",
          "odysseyHiddenCases",
          "title",
          "statementMarkdown",
          "signature",
          "publicCases",
          "privateCases",
        ].includes(key),
    )
  )
    throw bad("Invalid custom question");
  if (language === "postgresql")
    throw bad("Custom SQL interviews require a published SQL question");
  if (!(await capabilitiesInTransaction(tx, actor.userId)).authorCustomQuestions)
    throw new ApplicationError("forbidden", "Custom question access required", 403);
  const runtime = languageRuntime(language);
  if (!runtime) throw bad("Unsupported language");
  const id = crypto.randomUUID(),
    parent = crypto.randomUUID(),
    sig = { ...object(custom.signature) };
  if (!sig.className) sig.className = "Solution";
  const odyssey =
    custom.odyssey === undefined || custom.odyssey === null ? undefined : object(custom.odyssey);
  const publicCases = values(custom.publicCases),
    privateCases = values(custom.privateCases),
    suites = values(custom.odysseyHiddenCases);
  if (odyssey && (custom.publicCases != null || custom.privateCases != null))
    throw bad("Put staged examples and tests in their stages");
  if (!odyssey && (publicCases.length < 1 || publicCases.length > 20 || privateCases.length > 100))
    throw bad("Provide 1-20 public tests and at most 100 private tests");
  const levels = odyssey ? values(odyssey.levels) : [];
  const firstMethods = odyssey ? values(object(levels[0]).methods) : [sig];
  const implementations: JsonValue[] = [];
  for (const lang of ["python", "java", "typescript", "ocaml"] as const) {
    const selected = languageRuntime(lang);
    if (!selected) throw new Error("Missing supported runtime");
    const methods = JSON.parse(stringifyLosslessJson(firstMethods)) as Signature[];
    const starter = generateStarter(methods, lang as StarterLanguage, !!odyssey);
    implementations.push({
      language: lang,
      starterSource: starter,
      runtimeRevision: selected.revision,
      harnessRevision: selected.harness,
      referenceSource: "Private question uses explicit expected values",
    });
  }
  const selected = implementations.map(object).find((item) => item.language === language);
  if (!selected) throw bad("Unsupported language");
  const problem: Obj = {
    id,
    slug: `private-${id}`,
    version: "1",
    title: string(custom.title).trim(),
    difficulty: "easy",
    tags: [],
    companies: [],
    statementMarkdown: string(custom.statementMarkdown),
    signature: sig,
    constraints: [],
    limits: parseLosslessJson(JSON.stringify(defaultLimits())),
    examples: odyssey ? [] : publicCases,
    ...(odyssey ? { odyssey } : {}),
  };
  const content: Obj = {
    problem,
    hiddenCases: odyssey ? [] : privateCases,
    odysseyHiddenCases: odyssey ? suites : [],
    attribution: "Private interview",
    implementations,
    solutions: [],
  };
  try {
    validateQuestionDefinition(stringifyLosslessJson(content), validateQuestionSchema, false);
  } catch (error) {
    throw bad(error instanceof Error ? error.message : "Invalid custom question");
  }
  const fixture: Obj = {
    problem: {
      ...problem,
      slug: "interview-private",
      languages: implementations.map((item) => {
        const x = object(item);
        return {
          language: x.language,
          starterSource: x.starterSource,
          runtimeRevision: x.runtimeRevision,
          harnessRevision: x.harnessRevision,
        };
      }),
      starterSource: selected.starterSource,
      runtimeRevision: selected.runtimeRevision,
    },
    hiddenCases: content.hiddenCases,
    odysseyHiddenCases: content.odysseyHiddenCases,
    harnessRevision: selected.harnessRevision,
    referenceSource: "",
    attribution: "Private interview",
  };
  const stored = storageProjection(stringifyLosslessJson(fixture));
  // A custom interview without private tests publishes its examples as library tests.
  const library: Obj = {
    ...content,
    hiddenCases:
      !odyssey && privateCases.length === 0
        ? publicCases.map((c) => {
            const v = object(c),
              r: Obj = {};
            for (const k of ["args", "expected", "calls"]) if (v[k] !== undefined) r[k] = v[k];
            return r;
          })
        : content.hiddenCases,
  };
  return {
    safe: stored.safe,
    lossless: stored.lossless,
    source: string(selected.starterSource),
    language,
    fingerprint,
    persist: async (inner) => {
      await inner.execute(
        sql`INSERT INTO problems(id,slug,owner_id) VALUES(${parent}::uuid,${`private-${id}`},${actor.userId})`,
      );
      await persistQuestionVersion(
        inner,
        stringifyLosslessJson(library),
        parent,
        id,
        1,
        actor.userId,
        languageRuntime,
      );
    },
  };
}
