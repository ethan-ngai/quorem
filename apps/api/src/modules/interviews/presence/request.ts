/** @file request.ts @description Bounded advisory HTTP request decoding. @module interviews */
import { ApplicationError } from "../../../application/error.ts";
export async function advisoryBody(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader(),
    decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "",
    size = 0;
  try {
    if (reader)
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 1024) {
          await reader.cancel();
          throw new ApplicationError("payload_too_large", "Invalid request body", 413);
        }
        text += decoder.decode(part.value, { stream: true });
      }
    text += decoder.decode();
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError("invalid_input", "Invalid request body", 400);
  }
}
