/** @file parse.ts @description Bounded browser RPC decoding. @module events */
import { scanJsonSpans } from "@quorem/questions";
import type { SocketCommand } from "./ports.ts";
const encoder = new TextEncoder();
export function parseSocketCommand(text: string): SocketCommand {
  if (encoder.encode(text).length > 256 * 1024) throw new Error("Command too large");
  const span = scanJsonSpans(text),
    value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid command");
  const fields = value as Record<string, unknown>,
    id = fields.id,
    type = fields.type;
  if (
    typeof id !== "string" ||
    !id ||
    encoder.encode(id).length > 128 ||
    typeof type !== "string" ||
    !type ||
    encoder.encode(type).length > 128
  )
    throw new Error("Invalid command");
  const push = span.fields?.get("push");
  return { id, type, fields, ...(push ? { rawPush: text.slice(push.start, push.end) } : {}) };
}
