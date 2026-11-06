/** @file custom.ts @description Canonical private interview question construction. @module interviews */
import { sql } from "drizzle-orm";
import type { Transaction } from "@quorem/database/core";
import { defaultLimits, languageRuntime } from "@quorem/execution";
import {
  generateQuestionImplementations,
  publicQuestionProblem,
  parseLosslessJson,
  stringifyLosslessJson,
  validateQuestionDefinition,
  validateQuestionSchema,
  type JsonValue,
  type QuestionProblem,
  type AuthoredQuestionProblem,
} from "@quorem/questions";
import { questionRuntime } from "../../problems/runtime.ts";
import { ApplicationError } from "../../../../application/error.ts";
import type { Principal } from "../../../../modules/identity/model.ts";
import { validateCustomQuestionShape } from "../../../../modules/interviews/question/validation.ts";
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
  validateCustomQuestionShape(custom);
  if (language === "postgresql")
    throw bad("Custom SQL interviews require a published SQL question");
  if (!(await capabilitiesInTransaction(tx, actor.userId)).authorCustomQuestions)
    throw new ApplicationError("forbidden", "Custom question access required", 403);
  questionRuntime(language, false);
  const id = crypto.randomUUID(),
    parent = crypto.randomUUID(),
    sig = custom.odyssey ? undefined : { ...object(custom.signature) };
  if (sig && !sig.className) sig.className = "Solution";
  const odyssey =
    custom.odyssey === undefined || custom.odyssey === null ? undefined : object(custom.odyssey);
  const publicCases = values(custom.publicCases),
    privateCases = values(custom.privateCases),
    suites = custom.odyssey
      ? values(object(custom.odyssey).levels).map((level) => object(level).hiddenCases ?? [])
      : [];
  if (
    odyssey &&
    (custom.signature != null || custom.publicCases != null || custom.privateCases != null)
  )
    throw bad("Put staged examples and tests in their stages");
  if (!odyssey && (publicCases.length < 1 || publicCases.length > 20 || privateCases.length > 100))
    throw bad("Provide 1-20 public tests and at most 100 private tests");
  const problem: Obj = {
    id,
    slug: `private-${id}`,
    version: "1",
    title: string(custom.title).trim(),
    difficulty: "easy",
    tags: [],
    companies: [],
    statementMarkdown: string(custom.statementMarkdown),
    ...(sig ? { signature: sig } : {}),
    constraints: [],
    limits: parseLosslessJson(JSON.stringify(defaultLimits())),
    examples: odyssey ? [] : publicCases,
    ...(odyssey ? { odyssey } : {}),
  };
  const implementations = generateQuestionImplementations(
    JSON.parse(stringifyLosslessJson(problem)) as QuestionProblem,
    languageRuntime,
  );
  const selected = implementations.find((item) => item.language === language);
  if (!selected) throw bad("Unsupported language");
  const content: Obj = {
    problem,
    hiddenCases: odyssey ? [] : privateCases,
    attribution: "Private interview",
    canonicalApproachId: "",
    approaches: [],
  };
  try {
    validateQuestionDefinition(stringifyLosslessJson(content), validateQuestionSchema, false);
  } catch (error) {
    throw bad(error instanceof Error ? error.message : "Invalid custom question");
  }
  const fixture: Obj = {
    problem: {
      ...(publicQuestionProblem(problem as unknown as AuthoredQuestionProblem) as unknown as Obj),
      slug: "interview-private",
    },
    hiddenCases: content.hiddenCases,
    odysseyHiddenCases: odyssey ? suites : [],
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
    versionId: id,
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
        { customInterview: true },
      );
    },
  };
}
