/** @file draft-normalize.ts @description Normalize incomplete authoring drafts without losing case values. @module questions */
import { JsonNumber, parseLosslessJson, stringifyLosslessJson, type JsonValue } from "./json.ts";
import { validateQuestionDraft } from "./draft.ts";
import type { QuestionContent } from "./model.ts";
import validateDraft from "./draft-validator.mjs";

type Obj = { [key: string]: JsonValue };
function object(value: JsonValue | undefined): Obj {
  if (value === undefined || value === null) return Object.create(null) as Obj;
  if (typeof value !== "object" || Array.isArray(value) || value instanceof JsonNumber)
    throw new Error("invalid draft object");
  return value;
}
function field(o: Obj, key: string, value: JsonValue): void {
  if (o[key] === undefined || o[key] === null) o[key] = value;
}
function fields(o: Obj, keys: readonly string[]): void {
  for (const key of keys) field(o, key, "");
}
function array(value: JsonValue | undefined): JsonValue[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("invalid draft collection");
  return value;
}
function signature(value: JsonValue | undefined, primary: boolean): Obj {
  const sig = object(value);
  fields(sig, ["className", "methodName", "returnType"]);
  if (primary && sig.className === "") sig.className = "Solution";
  sig.parameters = array(sig.parameters).map((value) => {
    const parameter = object(value);
    fields(parameter, ["name", "type"]);
    if (parameter.input === null) delete parameter.input;
    else if (parameter.input !== undefined) {
      const input = object(parameter.input);
      fields(input, ["preset"]);
      parameter.input = input;
    }
    return parameter;
  });
  if (sig.throws !== undefined && sig.throws !== null)
    sig.throws = array(sig.throws).map((value) => {
      const item = object(value);
      fields(item, ["type", "description"]);
      return item;
    });
  return sig;
}
function cases(value: JsonValue | undefined): JsonValue[] {
  return array(value).map((entry) => {
    const c = object(entry);
    c.args = array(c.args);
    if (c.calls !== undefined && c.calls !== null)
      c.calls = array(c.calls).map((item) => {
        const call = object(item);
        fields(call, ["methodName"]);
        call.args = array(call.args);
        return call;
      });
    return c;
  });
}
/** Match the Go draft defaults while retaining numeric JSON lexemes. */
export function normalizeQuestionDraft(rawJson: string): string {
  if (new TextEncoder().encode(rawJson).length > 2 * 1024 * 1024)
    throw new Error("question content exceeds 2 MiB");
  const content = object(parseLosslessJson(rawJson)),
    p = object(content.problem);
  content.problem = p;
  fields(p, ["id", "slug", "version", "title", "difficulty", "statementMarkdown"]);
  if (p.id === "") p.id = "00000000-0000-4000-8000-000000000000";
  if (p.version === "") p.version = "0";
  if (p.difficulty === "") p.difficulty = "easy";
  p.tags = array(p.tags).map((v) => (v === null ? "" : v));
  p.companies = array(p.companies).map((v) => (v === null ? "" : v));
  p.examples = cases(p.examples);
  p.constraints = array(p.constraints).map((c) => {
    if (typeof c === "string") return { kind: "prose", text: c };
    const rule = object(c);
    fields(rule, ["kind"]);
    for (const key of ["target", "left", "right"])
      if (rule[key] !== undefined && rule[key] !== null) {
        const target = object(rule[key]);
        fields(target, ["parameter", "projection"]);
        rule[key] = target;
      }
    return rule;
  });
  p.signature = signature(p.signature, true);
  const limits = object(p.limits);
  for (const key of [
    "wallTimeMs",
    "memoryBytes",
    "outputBytes",
    "maxProcesses",
    "maxCollectionElements",
    "maxNestingDepth",
  ])
    field(limits, key, new JsonNumber("0"));
  if (
    Object.values(limits).every(
      (value) => value instanceof JsonNumber && Number(value.lexeme) === 0,
    )
  )
    p.limits = {
      wallTimeMs: new JsonNumber("2000"),
      memoryBytes: new JsonNumber("268435456"),
      outputBytes: new JsonNumber("65536"),
      maxProcesses: new JsonNumber("16"),
      maxCollectionElements: new JsonNumber("10000"),
      maxNestingDepth: new JsonNumber("100"),
    };
  else p.limits = limits;
  if (p.odyssey !== undefined && p.odyssey !== null) {
    const odyssey = object(p.odyssey);
    odyssey.levels = array(odyssey.levels).map((entry) => {
      const level = object(entry);
      fields(level, ["title", "statementMarkdown"]);
      level.methods = array(level.methods).map((method) => signature(method, false));
      level.examples = cases(level.examples);
      return level;
    });
    p.odyssey = odyssey;
  } else delete p.odyssey;
  if (p.sql === null) delete p.sql;
  else if (p.sql !== undefined) {
    const config = object(p.sql);
    fields(config, ["dialect", "outputOrder"]);
    if (config.tables !== undefined && config.tables !== null)
      config.tables = array(config.tables).map((v) => {
        const table = object(v);
        fields(table, ["name"]);
        table.columns = array(table.columns).map((x) => {
          const column = object(x);
          fields(column, ["name", "type"]);
          return column;
        });
        return table;
      });
    if (config.output !== undefined && config.output !== null)
      config.output = array(config.output).map((v) => {
        const column = object(v);
        fields(column, ["name", "type"]);
        return column;
      });
    p.sql = config;
  }
  if (p.leetcodeId === null) delete p.leetcodeId;
  content.hiddenCases = cases(content.hiddenCases);
  field(content, "attribution", "");
  content.implementations = array(content.implementations).map((value) => {
    const item = object(value);
    fields(item, [
      "language",
      "starterSource",
      "runtimeRevision",
      "harnessRevision",
      "referenceSource",
    ]);
    return item;
  });
  content.solutions = array(content.solutions).map((value) => {
    const item = object(value);
    fields(item, [
      "language",
      "source",
      "explanationMarkdown",
      "timeComplexity",
      "spaceComplexity",
      "complexityNotes",
    ]);
    return item;
  });
  if (content.odysseyHiddenCases !== undefined && content.odysseyHiddenCases !== null)
    content.odysseyHiddenCases = array(content.odysseyHiddenCases).map(cases);
  else delete content.odysseyHiddenCases;
  const result = stringifyLosslessJson(content);
  const ordinary = JSON.parse(result) as QuestionContent;
  if (!validateDraft(ordinary)) throw new Error("invalid question draft shape");
  validateQuestionDraft(ordinary);
  return result;
}
