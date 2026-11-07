/** @file json-body.ts @description Bounded UTF-8 JSON object decoding. @module application */
import { ApplicationError } from "./error.ts";
export async function jsonObjectBody(
  request: Request,
  limit: number,
): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "",
    size = 0;
  try {
    if (reader)
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > limit) {
          await reader.cancel();
          throw new ApplicationError("payload_too_large", "Request too large", 413);
        }
        text += decoder.decode(part.value, { stream: true });
      }
    text += decoder.decode();
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError("invalid_input", "Invalid request body", 400);
  }
}
