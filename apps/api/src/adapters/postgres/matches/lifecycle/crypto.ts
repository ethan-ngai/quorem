/** @file crypto.ts @description Invitation capability encryption and command fingerprints. @module matches */
import type { Settings } from "../../../../modules/matches/lifecycle/model.ts";
const enc = new TextEncoder();
const b64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
const unb64 = (text: string) =>
  Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
const goJSON = (value: unknown) =>
  JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
export async function digest(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value))), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export function settingsBody(s: Settings): object {
  return {
    questionFilters: s.questionFilters,
    admissionLocked: s.admissionLocked,
    accessMode: s.accessMode,
    mode: s.mode,
    difficulties: s.difficulties,
    ...(s.selectedProblemVersionId ? { selectedProblemVersionId: s.selectedProblemVersionId } : {}),
    rules: {
      ...(s.rules.hints === undefined ? {} : { hints: s.rules.hints }),
      clipboard: s.rules.clipboard,
      focus: s.rules.focus,
    },
    difficulty: s.difficulty,
    durationMinutes: s.durationMinutes,
  };
}
export const fingerprint = (value: unknown) => digest(goJSON(value));
export function token(): string {
  return b64(crypto.getRandomValues(new Uint8Array(32)));
}
/** Same AES-GCM envelope and associated data as the existing invitation cache. */
export function inviteCipher(secret: Uint8Array) {
  if (secret.length !== 32) throw new Error("Invalid invitation key");
  const key = crypto.subtle.importKey("raw", new Uint8Array(secret), "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]),
    aad = enc.encode("quorem:create-match:v1");
  return {
    async seal(data: unknown): Promise<object> {
      const nonce = crypto.getRandomValues(new Uint8Array(12));
      const cipher = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv: nonce, additionalData: aad },
          await key,
          enc.encode(goJSON(data)),
        ),
      );
      const out = new Uint8Array(nonce.length + cipher.length);
      out.set(nonce);
      out.set(cipher, nonce.length);
      return { encrypted: b64(out) };
    },
    async open(value: unknown): Promise<unknown> {
      if (
        !value ||
        typeof value !== "object" ||
        typeof (value as { encrypted?: unknown }).encrypted !== "string"
      )
        throw new Error("Invalid invitation envelope");
      const bytes = unb64((value as { encrypted: string }).encrypted);
      if (bytes.length < 28) throw new Error("Invalid invitation envelope");
      const data = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: aad },
        await key,
        bytes.slice(12),
      );
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
    },
  };
}
