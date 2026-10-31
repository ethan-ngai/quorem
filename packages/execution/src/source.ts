/** @file source.ts @description UTF-8 source identity. @module execution */
import { validSource } from "@quorem/questions";
/** Hash valid source bytes with SHA-256. */
export async function sourceHash(source: string): Promise<string> {
  if (!validSource(source)) throw new Error("invalid source");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
