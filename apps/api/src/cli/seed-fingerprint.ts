/** @file seed-fingerprint.ts @description Go-compatible seed operation lock identity. @module cli */
import { createHash } from "node:crypto";
import { markRawCases } from "../adapters/postgres/problems/case-literals.ts";
import {
  JsonNumber,
  normalizeQuestionDraft,
  parseLosslessJson,
  type JsonValue,
} from "@quorem/questions";
type Obj = { [key: string]: JsonValue };
const obj = (v: JsonValue | undefined): Obj => {
  if (!v || typeof v !== "object" || v instanceof JsonNumber || Array.isArray(v))
    throw new Error("Invalid seed content");
  return v;
};
const arr = (v: JsonValue | undefined): JsonValue[] => (Array.isArray(v) ? v : []);
const str = (v: JsonValue | undefined): string => (typeof v === "string" ? v : "");
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function optional(out: Obj, key: string, v: JsonValue | undefined): void {
  if (v !== undefined && v !== null && v !== "" && (!Array.isArray(v) || v.length > 0))
    out[key] = v;
}
function target(v: JsonValue): Obj {
  const x = obj(v);
  return { parameter: str(x.parameter), projection: str(x.projection) };
}
function constraint(v: JsonValue): Obj {
  const x = obj(v),
    out: Obj = { kind: str(x.kind) };
  if (x.target !== undefined && x.target !== null) out.target = target(x.target);
  for (const k of ["min", "max"])
    if (x[k] !== undefined && x[k] !== null)
      out[k] =
        x[k] instanceof JsonNumber
          ? new JsonNumber(
              Object.is(Number(x[k].lexeme), -0) ? "-0" : JSON.stringify(Number(x[k].lexeme)),
            )
          : x[k]!;
  for (const k of ["left", "right"])
    if (x[k] !== undefined && x[k] !== null) out[k] = target(x[k]!);
  for (const k of ["operator", "property", "text"]) optional(out, k, x[k]);
  return out;
}
function signature(v: JsonValue): Obj {
  const x = obj(v),
    out: Obj = {};
  for (const k of ["description", "returns"]) optional(out, k, x[k]);
  if (arr(x.throws).length)
    out.throws = arr(x.throws).map((t) => {
      const y = obj(t);
      return { type: str(y.type), description: str(y.description) };
    });
  optional(out, "outputOrder", x.outputOrder);
  out.className = str(x.className);
  out.methodName = str(x.methodName);
  out.parameters = arr(x.parameters).map((p) => {
    const y = obj(p),
      o: Obj = {};
    optional(o, "description", y.description);
    o.name = str(y.name);
    o.type = str(y.type);
    if (y.input) {
      const i = obj(y.input),
        z: Obj = { preset: str(i.preset) };
      if (i.placeholder !== undefined && i.placeholder !== null) z.placeholder = i.placeholder;
      if (i.rows !== undefined && i.rows !== null) z.rows = i.rows;
      o.input = z;
    }
    return o;
  });
  out.returnType = str(x.returnType);
  return out;
}
function testcase(v: JsonValue, example = false): Obj {
  const x = obj(v),
    out: Obj = {};
  if (arr(x.calls).length)
    out.calls = arr(x.calls).map((call) => {
      const q = obj(call),
        o: Obj = { methodName: str(q.methodName), args: q.args ?? [] };
      if (q.expected !== undefined) o.expected = q.expected;
      return o;
    });
  out.args = x.args ?? [];
  if (x.expected !== undefined) out.expected = x.expected;
  if (example) optional(out, "explanation", x.explanation);
  return out;
}
function sqlConfig(v: JsonValue): Obj {
  const x = obj(v),
    o: Obj = { dialect: str(x.dialect), outputOrder: str(x.outputOrder) };
  if (arr(x.tables).length)
    o.tables = arr(x.tables).map((t) => {
      const y = obj(t);
      return {
        name: str(y.name),
        columns: arr(y.columns).map((c) => {
          const z = obj(c);
          return { name: str(z.name), type: str(z.type) };
        }),
      };
    });
  if (arr(x.output).length)
    o.output = arr(x.output).map((c) => {
      const z = obj(c);
      return { name: str(z.name), type: str(z.type) };
    });
  return o;
}
function ordered(v: JsonValue): string {
  if (v instanceof JsonNumber) return v.lexeme;
  if (Array.isArray(v)) return `[${v.map(ordered).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.entries(v)
      .map(([k, x]) => `${JSON.stringify(k)}:${ordered(x)}`)
      .join(",")}}`;
  return JSON.stringify(v);
}
/** Operation IDs must share the original Go advisory lock while old seeders coexist. */
export function seedFingerprint(raw: string, actor: string): { fingerprint: string; slug: string } {
  const c = obj(parseLosslessJson(normalizeQuestionDraft(raw))),
    p = obj(c.problem),
    source = obj(parseLosslessJson(raw)),
    sourceProblem = obj(source.problem),
    problem: Obj = {};
  if (Array.isArray(source.hiddenCases)) c.hiddenCases = source.hiddenCases;
  if (Array.isArray(source.odysseyHiddenCases)) c.odysseyHiddenCases = source.odysseyHiddenCases;
  if (Array.isArray(sourceProblem.examples)) p.examples = sourceProblem.examples;
  if (p.odyssey && sourceProblem.odyssey) {
    const stages = arr(obj(p.odyssey).levels),
      originals = arr(obj(sourceProblem.odyssey).levels);
    stages.forEach((level, index) => {
      const original = originals[index];
      if (original && Array.isArray(obj(original).examples))
        obj(level).examples = obj(original).examples!;
    });
  }
  const marks = markRawCases(raw, c);
  if (p.sql) problem.sql = sqlConfig(p.sql);
  if (p.odyssey) {
    const o = obj(p.odyssey);
    problem.odyssey = {
      levels: arr(o.levels).map((level) => {
        const x = obj(level);
        return {
          title: str(x.title),
          statementMarkdown: str(x.statementMarkdown),
          methods: arr(x.methods).map(signature),
          examples: arr(x.examples).map((v) => testcase(v, true)),
        };
      }),
    };
  }
  const prefix = `private-${hash(actor).slice(0, 16)}-`;
  let slug = str(p.slug);
  if (slug.startsWith(prefix)) slug = slug.slice(prefix.length);
  Object.assign(problem, {
    id: "",
    slug,
    version: "",
    title: str(p.title),
    difficulty: str(p.difficulty),
    tags: arr(p.tags),
    companies: arr(p.companies),
  });
  if (p.leetcodeId !== undefined && p.leetcodeId !== null) problem.leetcodeId = p.leetcodeId;
  problem.statementMarkdown = str(p.statementMarkdown);
  problem.examples = arr(p.examples).map((v) => testcase(v, true));
  problem.constraints = arr(p.constraints).map(constraint);
  problem.signature = signature(p.signature!);
  const l = obj(p.limits);
  problem.limits = {
    wallTimeMs: l.wallTimeMs!,
    memoryBytes: l.memoryBytes!,
    outputBytes: l.outputBytes!,
    maxProcesses: l.maxProcesses!,
    maxCollectionElements: l.maxCollectionElements!,
    maxNestingDepth: l.maxNestingDepth!,
  };
  const out: Obj = {};
  if (arr(c.odysseyHiddenCases).length)
    out.odysseyHiddenCases = arr(c.odysseyHiddenCases).map((stage) =>
      arr(stage).map((v) => testcase(v)),
    );
  out.problem = problem;
  out.hiddenCases = arr(c.hiddenCases).map((v) => testcase(v));
  out.attribution = str(c.attribution);
  const sorted = (v: JsonValue | undefined) =>
    arr(v)
      .map(obj)
      .sort((a, b) =>
        str(a.language) < str(b.language) ? -1 : str(a.language) > str(b.language) ? 1 : 0,
      );
  out.implementations = sorted(c.implementations).map((i) => ({
    language: str(i.language),
    starterSource: "",
    runtimeRevision: str(i.runtimeRevision),
    harnessRevision: str(i.harnessRevision),
    referenceSource: str(i.referenceSource),
  }));
  out.solutions = sorted(c.solutions).map((i) => ({
    language: str(i.language),
    source: str(i.source),
    explanationMarkdown: str(i.explanationMarkdown),
    timeComplexity: str(i.timeComplexity),
    spaceComplexity: str(i.spaceComplexity),
    complexityNotes: str(i.complexityNotes),
  }));
  if (arr(out.solutions).length === 0) out.solutions = null;
  let serialized = ordered(out);
  serialized = serialized.replace(
    /"__quorem_raw_[0-9a-f-]+_\d+__"/g,
    (marker) => marks.get(marker) ?? marker,
  );
  serialized = serialized.replace(
    /[<>&\u2028\u2029]/g,
    (x) => `\\u${x.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  return { slug, fingerprint: hash(serialized) };
}
