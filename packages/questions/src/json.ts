/** @file json.ts @description Lossless JSON numbers for question codecs. @module questions */

/** A JSON number token, preserved without IEEE-754 conversion. */
export class JsonNumber {
  readonly lexeme: string;
  constructor(lexeme: string) {
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(lexeme))
      throw new Error("invalid JSON number");
    this.lexeme = lexeme;
  }
}
export type JsonValue =
  | null
  | boolean
  | string
  | JsonNumber
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Parse JSON while retaining number lexemes. */
export function parseLosslessJson(text: string): JsonValue {
  let i = 0;
  const whitespace = () => {
    while (i < text.length && /[\t\n\r ]/.test(text[i])) i++;
  };
  const parseString = (): string => {
    const start = i++;
    while (i < text.length) {
      if (text[i] === "\\") {
        i += 2;
        continue;
      }
      if (text[i++] === '"')
        return (JSON.parse(text.slice(start, i)) as string).replace(
          /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/gu,
          "\uFFFD",
        );
    }
    throw new Error("malformed value");
  };
  const parse = (depth: number): JsonValue => {
    if (depth > 10000) throw new Error("malformed value");
    whitespace();
    if (text[i] === '"') return parseString();
    if (text[i] === "[") {
      i++;
      const values: JsonValue[] = [];
      whitespace();
      if (text[i] === "]") {
        i++;
        return values;
      }
      while (true) {
        values.push(parse(depth + 1));
        whitespace();
        if (text[i] === "]") {
          i++;
          return values;
        }
        if (text[i++] !== ",") throw new Error("malformed value");
      }
    }
    if (text[i] === "{") {
      i++;
      const value: { [key: string]: JsonValue } = Object.create(null) as {
        [key: string]: JsonValue;
      };
      whitespace();
      if (text[i] === "}") {
        i++;
        return value;
      }
      while (true) {
        whitespace();
        if (text[i] !== '"') throw new Error("malformed value");
        const key = parseString();
        whitespace();
        if (text[i++] !== ":") throw new Error("malformed value");
        value[key] = parse(depth + 1);
        whitespace();
        if (text[i] === "}") {
          i++;
          return value;
        }
        if (text[i++] !== ",") throw new Error("malformed value");
      }
    }
    for (const [literal, value] of [
      ["null", null],
      ["true", true],
      ["false", false],
    ] as const)
      if (text.startsWith(literal, i)) {
        i += literal.length;
        return value;
      }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
    if (!number) throw new Error("malformed value");
    i += number[0].length;
    return new JsonNumber(number[0]);
  };
  try {
    const value = parse(0);
    whitespace();
    if (i !== text.length) throw new Error("malformed value");
    return value;
  } catch {
    throw new Error("malformed value");
  }
}

const quote = (value: string): string =>
  JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
/** Compare canonical UTF-8 byte strings. */
export function compareUtf8(a: string, b: string): number {
  const x = new TextEncoder().encode(a),
    y = new TextEncoder().encode(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}
/** Serialize lossless values with Go-compatible string escaping and key order. */
export function stringifyLosslessJson(value: JsonValue): string {
  if (value instanceof JsonNumber) return value.lexeme;
  if (value === null || typeof value === "boolean") return String(value);
  if (typeof value === "string") return quote(value);
  if (Array.isArray(value)) return `[${value.map(stringifyLosslessJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort(compareUtf8)
    .map((key) => `${quote(key)}:${stringifyLosslessJson(value[key])}`)
    .join(",")}}`;
}
