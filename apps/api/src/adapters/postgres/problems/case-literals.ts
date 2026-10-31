/** @file raw-cases.ts @description Preserve Go RawMessage spelling for seed lock compatibility. @module cli */
import {
  JsonNumber,
  normalizeQuestionDraft,
  parseLosslessJson,
  stringifyLosslessJson,
  type JsonValue,
} from "@quorem/questions";
type Obj = { [key: string]: JsonValue };
type Node = { start: number; end: number; fields?: Map<string, Node>; items?: Node[] };
const object = (v: JsonValue | undefined): Obj | undefined =>
  v && typeof v === "object" && !Array.isArray(v) && !(v instanceof JsonNumber) ? v : undefined;
const array = (v: JsonValue | undefined): JsonValue[] => (Array.isArray(v) ? v : []);

/** Scan already validated JSON without decoding raw case values. */
function scan(raw: string): Node {
  let i = 0;
  const space = () => {
    while (/[\t\n\r ]/.test(raw[i] ?? "") && i < raw.length) i++;
  };
  function string(): string {
    const start = i++;
    while (i < raw.length) {
      if (raw[i] === "\\") {
        i += 2;
        continue;
      }
      if (raw[i++] === '"') return JSON.parse(raw.slice(start, i)) as string;
    }
    throw new Error("Invalid JSON string");
  }
  function value(): Node {
    space();
    const start = i,
      node: Node = { start, end: 0 };
    if (raw[i] === "{") {
      i++;
      node.fields = new Map();
      space();
      while (raw[i] !== "}") {
        space();
        const key = string();
        space();
        if (raw[i++] !== ":") throw new Error("Invalid JSON");
        node.fields.set(key, value());
        space();
        if (raw[i] !== ",") break;
        i++;
      }
      if (raw[i++] !== "}") throw new Error("Invalid JSON");
    } else if (raw[i] === "[") {
      i++;
      node.items = [];
      space();
      while (raw[i] !== "]") {
        node.items.push(value());
        space();
        if (raw[i] !== ",") break;
        i++;
      }
      if (raw[i++] !== "]") throw new Error("Invalid JSON");
    } else if (raw[i] === '"') string();
    else {
      while (i < raw.length && !/[\t\n\r ,\]}]/.test(raw[i]!)) i++;
    }
    node.end = i;
    return node;
  }
  return value();
}
function compact(raw: string): string {
  let quoted = false,
    escaped = false,
    out = "";
  for (const c of raw) {
    if (quoted) {
      out += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') {
      quoted = true;
      out += c;
    } else if (!/[\t\n\r ]/.test(c)) out += c;
  }
  return out;
}
/** Replace raw case values with opaque markers, restored after structural encoding. */
export function markRawCases(raw: string, content: Obj): Map<string, string> {
  const root = scan(raw),
    marks = new Map<string, string>(),
    nonce = crypto.randomUUID();
  let counter = 0;
  const mark = (node: Node): string => {
    const token = `__quorem_raw_${nonce}_${counter++}__`;
    marks.set(JSON.stringify(token), compact(raw.slice(node.start, node.end)));
    return token;
  };
  const fields = (node: Node | undefined, key: string) => node?.fields?.get(key);
  function caseValue(value: JsonValue, node: Node | undefined): void {
    const c = object(value);
    if (!c || !node) return;
    const args = fields(node, "args");
    if (args?.items) c.args = args.items.map(mark);
    const expected = fields(node, "expected");
    if (expected) c.expected = mark(expected);
    const calls = fields(node, "calls")?.items;
    array(c.calls).forEach((call, index) => caseValue(call, calls?.[index]));
  }
  const sourceProblem = fields(root, "problem"),
    p = object(content.problem);
  const cases = (values: JsonValue | undefined, nodes: Node[] | undefined) =>
    array(values).forEach((value, index) => caseValue(value, nodes?.[index]));
  cases(content.hiddenCases, fields(root, "hiddenCases")?.items);
  const suites = fields(root, "odysseyHiddenCases")?.items;
  array(content.odysseyHiddenCases).forEach((suite, index) => cases(suite, suites?.[index]?.items));
  cases(p?.examples, fields(sourceProblem, "examples")?.items);
  const odyssey = object(p?.odyssey),
    levels = fields(fields(sourceProblem, "odyssey"), "levels")?.items;
  array(odyssey?.levels).forEach((level, index) =>
    cases(object(level)?.examples, fields(levels?.[index], "examples")?.items),
  );
  return marks;
}

export function canonicalCaseValue(value: JsonValue): JsonValue {
  if (value instanceof JsonNumber) {
    const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value.lexeme)!;
    let digits = (match[2]! + (match[3] ?? "")).replace(/^0+/, "");
    if (!digits) return new JsonNumber("0");
    let exponent = BigInt(match[4] ?? "0") - BigInt((match[3] ?? "").length);
    while (digits.endsWith("0")) {
      digits = digits.slice(0, -1);
      exponent++;
    }
    return new JsonNumber(`${match[1]}${digits}${exponent === 0n ? "" : `e${exponent}`}`);
  }
  if (Array.isArray(value)) return value.map(canonicalCaseValue);
  if (value && typeof value === "object" && !(value instanceof JsonNumber))
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonicalCaseValue(v)]),
    );
  return value;
}
function caseProjection(c: Obj): JsonValue {
  const p = object(c.problem);
  const levels = array(object(p?.odyssey)?.levels);
  return {
    examples: p?.examples ?? [],
    hiddenCases: c.hiddenCases ?? [],
    odysseyHiddenCases: c.odysseyHiddenCases ?? [],
    stages: levels.map((level) => object(level)?.examples ?? []),
  };
}
/** Preserve only case lexemes after checking their decoded values have not changed. */
export function preserveCaseLiterals(source: string, published: string): Uint8Array | null {
  const before = object(parseLosslessJson(normalizeQuestionDraft(source))),
    after = object(parseLosslessJson(published));
  if (
    !before ||
    !after ||
    stringifyLosslessJson(canonicalCaseValue(caseProjection(before))) !==
      stringifyLosslessJson(canonicalCaseValue(caseProjection(after)))
  )
    throw new Error("Seed cases differ from publication");
  const canonical = stringifyLosslessJson(after);
  const marks = markRawCases(source, after);
  const restored = stringifyLosslessJson(after).replace(
    /"__quorem_raw_[0-9a-f-]+_\d+__"/g,
    (marker) => marks.get(marker) ?? marker,
  );
  return restored === canonical ? null : new TextEncoder().encode(restored);
}
