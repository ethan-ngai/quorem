/** @file value-codec.ts @description Typed coding question JSON values. @module questions */
import { nodeType, treeEntryCount } from "@quorem/contracts/node-type";
import { isLongValue } from "@quorem/contracts/long";
import { JsonNumber, parseLosslessJson, stringifyLosslessJson, type JsonValue } from "./json.ts";
import { validQuestionType } from "./signature.ts";

function validDatetime(text: string): boolean {
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)$/.exec(text);
  if (!match || match[1] === "0000") return false;
  const [, y, m, d, h, min, s] = match.map(Number);
  if (m < 1 || m > 12 || h > 23 || min > 59 || s > 59) return false;
  const days = [
    31,
    y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return d >= 1 && d <= days[m - 1];
}

/** Normalize a decoded question value while enforcing collection and type limits. */
export function normalizeQuestionValue(type: string, value: JsonValue, limit = 10000): JsonValue {
  type = type.replaceAll("array<", "list<");
  if (!validQuestionType(type)) throw new Error("unknown or excessively nested type");
  let count = 0;
  const normalize = (kind: string, current: JsonValue, depth: number): JsonValue => {
    if (depth > 100) throw new Error("nesting exceeds 100");
    if (depth > 0 && ++count > limit) throw new Error(`collection exceeds ${limit} elements`);
    if (kind.startsWith("optional<"))
      return current === null ? null : normalize(kind.slice(9, -1), current, depth + 1);
    const node = nodeType(kind);
    if (node) {
      if (current === null) return null;
      if (!Array.isArray(current)) throw new Error("node requires array or null");
      if (current.length > limit) throw new Error("too many nodes");
      const length = node.kind === "ListNode" ? current.length : treeEntryCount(node.kind, current);
      if (!length) return null;
      return current
        .slice(0, length)
        .map((item) =>
          item === null && node.kind !== "ListNode"
            ? null
            : normalize(node.payload, item, depth + 1),
        );
    }
    if (kind.startsWith("list<")) {
      if (!Array.isArray(current)) throw new Error("expected list");
      return current.map((item) => normalize(kind.slice(5, -1), item, depth + 1));
    }
    switch (kind) {
      case "int": {
        if (!(current instanceof JsonNumber)) throw new Error("expected integer");
        if (!/^-?\d+$/.test(current.lexeme)) throw new Error("expected signed 32-bit integer");
        const value = BigInt(current.lexeme);
        if (value < -2147483648n || value > 2147483647n)
          throw new Error("expected signed 32-bit integer");
        return new JsonNumber(value.toString());
      }
      case "long":
        if (!isLongValue(current)) throw new Error("expected signed 64-bit decimal string");
        return current;
      case "float": {
        if (!(current instanceof JsonNumber)) throw new Error("expected finite float");
        const value = Number(current.lexeme);
        if (!Number.isFinite(value)) throw new Error("expected finite float");
        return new JsonNumber(Object.is(value, -0) ? "0" : JSON.stringify(value));
      }
      case "str":
        if (typeof current !== "string") throw new Error("expected string");
        return current;
      case "bool":
        if (typeof current !== "boolean") throw new Error("expected bool");
        return current;
      case "datetime":
        if (typeof current !== "string" || !validDatetime(current))
          throw new Error("expected datetime as YYYY-MM-DDTHH:MM:SS");
        return current;
      default:
        throw new Error("unknown type");
    }
  };
  return normalize(type, value, 0);
}

/** Decode and normalize a raw coding-value JSON document. */
export function normalizeQuestionJson(type: string, json: string, limit = 10000): string {
  return stringifyLosslessJson(normalizeQuestionValue(type, parseLosslessJson(json), limit));
}
