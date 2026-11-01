/** @file fingerprint.ts @description Go-compatible interview create identity. @module interviews */
import { JsonNumber, type JsonValue } from "@quorem/questions";
type Obj = Record<string, unknown>;
function ordered(v: unknown): string {
  if (v instanceof JsonNumber) return v.lexeme;
  if (v === null || typeof v === "boolean" || typeof v === "number") return JSON.stringify(v);
  if (typeof v === "string")
    return JSON.stringify(v).replace(
      /[<>&\u2028\u2029]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
  if (Array.isArray(v)) return `[${v.map(ordered).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.entries(v)
      .filter(([, x]) => x !== undefined)
      .map(([k, x]) => `${ordered(k)}:${ordered(x)}`)
      .join(",")}}`;
  throw new Error("Invalid fingerprint value");
}
const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonNumber) ? (v as Obj) : {};
const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const opt = (o: Obj, k: string) =>
  o[k] !== undefined &&
  o[k] !== null &&
  o[k] !== "" &&
  (!Array.isArray(o[k]) || (o[k] as unknown[]).length > 0);
function signature(v: unknown): Obj {
  const s = obj(v);
  return {
    ...(opt(s, "description") ? { description: s.description } : {}),
    ...(opt(s, "returns") ? { returns: s.returns } : {}),
    ...(opt(s, "throws")
      ? {
          throws: array(s.throws).map((x) => {
            const e = obj(x);
            return { type: e.type ?? "", description: e.description ?? "" };
          }),
        }
      : {}),
    ...(opt(s, "outputOrder") ? { outputOrder: s.outputOrder } : {}),
    className: s.className ?? "",
    methodName: s.methodName ?? "",
    parameters:
      s.parameters === undefined || s.parameters === null
        ? null
        : array(s.parameters).map((x) => {
            const p = obj(x),
              input = obj(p.input);
            return {
              ...(opt(p, "description") ? { description: p.description } : {}),
              name: p.name ?? "",
              type: p.type ?? "",
              ...(p.input != null
                ? {
                    input: {
                      preset: input.preset ?? "",
                      ...(input.placeholder != null ? { placeholder: input.placeholder } : {}),
                      ...(input.rows != null ? { rows: input.rows } : {}),
                    },
                  }
                : {}),
            };
          }),
    returnType: s.returnType ?? "",
  };
}
function testCase(value: unknown, example = false): Obj {
  const c = obj(value),
    calls = array(c.calls);
  return {
    ...(calls.length
      ? {
          calls: calls.map((x) => {
            const call = obj(x);
            return {
              methodName: call.methodName ?? "",
              args: call.args ?? null,
              ...(call.expected !== undefined ? { expected: call.expected } : {}),
            };
          }),
        }
      : {}),
    args: c.args ?? null,
    ...(c.expected !== undefined ? { expected: c.expected } : {}),
    ...(example && opt(c, "explanation") ? { explanation: c.explanation } : {}),
  };
}
function custom(v: unknown): Obj {
  const c = obj(v),
    od = obj(c.odyssey),
    levels = array(od.levels);
  return {
    ...(c.odyssey != null
      ? {
          odyssey: {
            levels: levels.map((x) => {
              const level = obj(x);
              return {
                title: level.title ?? "",
                statementMarkdown: level.statementMarkdown ?? "",
                methods: level.methods == null ? null : array(level.methods).map(signature),
                examples:
                  level.examples == null
                    ? null
                    : array(level.examples).map((x) => testCase(x, true)),
              };
            }),
          },
        }
      : {}),
    ...(opt(c, "odysseyHiddenCases")
      ? {
          odysseyHiddenCases: array(c.odysseyHiddenCases).map((s) =>
            array(s).map((x) => testCase(x)),
          ),
        }
      : {}),
    title: c.title ?? "",
    statementMarkdown: c.statementMarkdown ?? "",
    signature: signature(c.signature),
    ...(opt(c, "publicCases") ? { publicCases: array(c.publicCases).map((x) => testCase(x)) } : {}),
    ...(opt(c, "privateCases")
      ? { privateCases: array(c.privateCases).map((x) => testCase(x)) }
      : {}),
  };
}
function questionBody(question: unknown): Obj {
  const q = obj(question),
    h = obj(q.hints);
  return {
    ...(q.hints != null
      ? {
          hints: {
            ...(h.topics != null ? { topics: h.topics } : {}),
            ...(h.complexity != null ? { complexity: h.complexity } : {}),
          },
        }
      : {}),
    ...(opt(q, "problemVersionId") ? { problemVersionId: q.problemVersionId } : {}),
    ...(q.custom != null ? { custom: custom(q.custom) } : {}),
    language: q.language ?? "",
  };
}
export async function interviewQuestionOperationFingerprint(
  scope: string,
  question: unknown,
  rawCases?: ReadonlyMap<string, string>,
): Promise<string> {
  return interviewCommandFingerprint(scope, questionBody(question), rawCases);
}
export async function interviewCommandFingerprint(
  scope: string,
  body: unknown,
  rawCases?: ReadonlyMap<string, string>,
): Promise<string> {
  let payload = ordered(body);
  if (rawCases)
    payload = payload.replace(
      /"__quorem_raw_[0-9a-f-]+_\d+__"/g,
      (marker) => rawCases.get(marker) ?? marker,
    );
  payload = payload.replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${scope}:${payload}`),
  );
  return Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join("");
}
/** Produce the exact persisted operation fingerprint used by the Go create command. */
export async function interviewCreateFingerprint(
  title: string,
  question: unknown,
  monitoring: unknown,
  rawCases?: ReadonlyMap<string, string>,
): Promise<string> {
  const m = obj(monitoring);
  const body = {
    ...(monitoring != null
      ? {
          monitoring: {
            ...(m.paste != null ? { paste: m.paste } : {}),
            ...(m.focus != null ? { focus: m.focus } : {}),
          },
        }
      : {}),
    title,
    question: questionBody(question),
  };
  return interviewCommandFingerprint("create", body, rawCases);
}
function lossless(value: unknown): JsonValue {
  if (value instanceof JsonNumber) return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Invalid number");
    return new JsonNumber(Object.is(value, -0) ? "-0" : String(value));
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(lossless);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, lossless(item)]));
  throw new Error("Invalid value");
}
export function losslessObject(value: unknown): { [key: string]: JsonValue } {
  const result = lossless(value);
  if (
    !result ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    result instanceof JsonNumber
  )
    throw new Error("Invalid object");
  return result;
}
