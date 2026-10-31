/** @file json-spans.ts @description Validated source spans for lossless JSON. @module questions */
import { parseLosslessJson } from "./json.ts";
export type JsonSpan = {
  start: number;
  end: number;
  fields?: Map<string, JsonSpan>;
  items?: JsonSpan[];
};
/** Validate JSON and expose exact token spans without changing their spelling. */
export function scanJsonSpans(raw: string): JsonSpan {
  parseLosslessJson(raw);
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
  function value(): JsonSpan {
    space();
    const start = i,
      node: JsonSpan = { start, end: 0 };
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
