/** @file wire.ts @description Exact JSON field extraction for private wire contracts. @module execution */
import {
  JsonNumber,
  parseLosslessJson,
  stringifyLosslessJson,
  type JsonValue,
} from "@quorem/questions";
export type ObjectValue = { [key: string]: JsonValue };
export function decodeObject(json: string): ObjectValue {
  const value = parseLosslessJson(json);
  if (!value || typeof value !== "object" || value instanceof JsonNumber || Array.isArray(value))
    throw new Error("expected JSON object");
  return value;
}
export function stringField(obj: ObjectValue, key: string): string {
  const value = obj[key];
  if (typeof value !== "string" || !value) throw new Error(`invalid ${key}`);
  return value;
}
export function intField(obj: ObjectValue, key: string, min: bigint, max: bigint): bigint {
  const value = obj[key];
  if (!(value instanceof JsonNumber) || !/^-?\d+$/.test(value.lexeme))
    throw new Error(`invalid ${key}`);
  const n = BigInt(value.lexeme);
  if (n < min || n > max) throw new Error(`invalid ${key}`);
  return n;
}
export function rawJson(value: JsonValue): string {
  return stringifyLosslessJson(value);
}
/** Extract raw top-level values after strict JSON validation. */
export function rawFields(json: string): Map<string, string> {
  decodeObject(json);
  let i = 0;
  const result = new Map<string, string>();
  const ws = () => {
    while (/[\t\r\n ]/.test(json[i] ?? "\0")) i++;
  };
  ws();
  i++;
  while (true) {
    ws();
    if (json[i] === "}") break;
    const start = i++;
    while (i < json.length) {
      if (json[i] === "\\") {
        i += 2;
        continue;
      }
      if (json[i++] === '"') break;
    }
    const key = JSON.parse(json.slice(start, i)) as string;
    ws();
    i++;
    ws();
    const from = i;
    let depth = 0,
      inString = false;
    while (i < json.length) {
      const c = json[i];
      if (inString) {
        if (c === "\\") {
          i += 2;
          continue;
        }
        if (c === '"') inString = false;
        i++;
        continue;
      }
      if (c === '"') {
        inString = true;
        i++;
        continue;
      }
      if (c === "{" || c === "[") {
        depth++;
        i++;
        continue;
      }
      if (c === "}" || c === "]") {
        if (depth === 0) break;
        depth--;
        i++;
        continue;
      }
      if (c === "," && depth === 0) break;
      i++;
    }
    if (result.has(key)) throw new Error("duplicate JSON field");
    result.set(key, json.slice(from, i).trimEnd());
    ws();
    if (json[i] === ",") {
      i++;
      continue;
    }
    break;
  }
  return result;
}
