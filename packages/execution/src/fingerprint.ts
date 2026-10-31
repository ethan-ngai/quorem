import {
  JsonNumber,
  parseLosslessJson,
  stringifyLosslessJson,
  type JsonValue,
} from "@quorem/questions";

function object(value: JsonValue): Record<string, JsonValue> {
  if (!value || typeof value !== "object" || value instanceof JsonNumber || Array.isArray(value))
    throw new Error("expected object");
  return value;
}
function scanString(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2;
      continue;
    }
    if (text[i++] === '"') return i;
  }
  throw new Error("invalid JSON string");
}
function skip(text: string, i: number): number {
  while (/[\t\n\r ]/.test(text[i] ?? "")) i++;
  return i;
}
function endValue(text: string, start: number): number {
  let i = start,
    depth = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      i = scanString(text, i);
      continue;
    }
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      if (!depth) return i;
      depth--;
    } else if (c === "," && !depth) return i;
    i++;
  }
  return i;
}
function members(raw: string): Map<string, string> {
  const result = new Map<string, string>();
  let i = skip(raw, 1);
  while (raw[i] !== "}") {
    const end = scanString(raw, i),
      key = JSON.parse(raw.slice(i, end)) as string;
    i = skip(raw, end);
    if (raw[i++] !== ":") throw new Error("invalid object");
    i = skip(raw, i);
    const next = endValue(raw, i);
    result.set(key, raw.slice(i, next).trim());
    i = skip(raw, next);
    if (raw[i] === ",") i = skip(raw, i + 1);
    else if (raw[i] !== "}") throw new Error("invalid object");
  }
  return result;
}
function elements(raw: string): string[] {
  const result: string[] = [];
  let i = skip(raw, 1);
  while (raw[i] !== "]") {
    const end = endValue(raw, i);
    result.push(raw.slice(i, end).trim());
    i = skip(raw, end);
    if (raw[i] === ",") i = skip(raw, i + 1);
    else if (raw[i] !== "]") throw new Error("invalid array");
  }
  return result;
}
/** Match encoding/json RawMessage: compact whitespace and HTML-escape without sorting nested keys. */
function rawJSON(raw: string): string {
  let result = "",
    inString = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inString && c === "\\") {
      result += c + raw[++i];
      continue;
    }
    if (c === '"') {
      inString = !inString;
      result += c;
      continue;
    }
    if (!inString && /[\t\n\r ]/.test(c)) continue;
    if (inString && /[<>&\u2028\u2029]/.test(c))
      result += `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`;
    else result += c;
  }
  return result;
}
function goCall(raw: string): string {
  const c = object(parseLosslessJson(raw)),
    fields = members(raw);
  if (c.methodName !== undefined && c.methodName !== null && typeof c.methodName !== "string")
    throw new Error("invalid method");
  if (c.args !== undefined && c.args !== null && !Array.isArray(c.args))
    throw new Error("invalid args");
  return `{\"methodName\":${stringifyLosslessJson(c.methodName ?? "")},\"args\":${fields.has("args") ? rawJSON(fields.get("args")!) : "null"}${fields.has("expected") ? `,\"expected\":${rawJSON(fields.get("expected")!)}` : ""}}`;
}
function goCase(raw: string): string {
  const c = object(parseLosslessJson(raw)),
    fields = members(raw);
  if (c.args !== undefined && c.args !== null && !Array.isArray(c.args))
    throw new Error("invalid args");
  if (c.calls !== undefined && c.calls !== null && !Array.isArray(c.calls))
    throw new Error("invalid calls");
  const calls =
    Array.isArray(c.calls) && c.calls.length ? elements(fields.get("calls")!).map(goCall) : [];
  return `{${calls.length ? `\"calls\":[${calls.join(",")}],` : ""}\"args\":${fields.has("args") ? rawJSON(fields.get("args")!) : "null"}${fields.has("expected") ? `,\"expected\":${rawJSON(fields.get("expected")!)}` : ""}}`;
}
/** Canonical bytes match json.Marshal(judging.Command) after its JSON decoder. */
export function canonicalWorkspaceCommand(raw: string): string {
  const c = object(parseLosslessJson(raw)),
    fields = members(raw);
  const workspaceId = c.workspaceId ?? "",
    kind = c.kind ?? "",
    source = c.source ?? "";
  if (typeof workspaceId !== "string" || typeof kind !== "string" || typeof source !== "string")
    throw new Error("invalid command");
  const level = c.level ?? new JsonNumber("0");
  if (!(level instanceof JsonNumber) || !/^-?\d+$/.test(level.lexeme))
    throw new Error("invalid level");
  const normalized = BigInt(level.lexeme);
  if (normalized < -9223372036854775808n || normalized > 9223372036854775807n)
    throw new Error("invalid level");
  if (c.customCases !== undefined && c.customCases !== null && !Array.isArray(c.customCases))
    throw new Error("invalid cases");
  const cases =
    Array.isArray(c.customCases) && c.customCases.length
      ? elements(fields.get("customCases")!).map(goCase)
      : [];
  return `{${normalized ? `\"level\":${normalized},` : ""}\"workspaceId\":${stringifyLosslessJson(workspaceId)},\"kind\":${stringifyLosslessJson(kind)},\"source\":${stringifyLosslessJson(source)}${cases.length ? `,\"customCases\":[${cases.join(",")}]` : ""}}`;
}
export async function workspaceCommandFingerprint(raw: string): Promise<string> {
  const data = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalWorkspaceCommand(raw)),
  );
  return Array.from(new Uint8Array(data), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
