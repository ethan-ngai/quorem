/** @file artifact.ts @description Validate opaque compiled artifacts before reuse. @module execution */
import { JsonNumber } from "@quorem/questions";
import { decodeObject, intField, stringField } from "./wire.ts";
const maxArtifactBytes = 4 << 20;
/** Validate the runner's versioned compiled artifact and entrypoint. */
export function validateCompiledArtifact(raw: string, language: string): void {
  if (!raw || new TextEncoder().encode(raw).length > maxArtifactBytes)
    throw new Error("compiled artifact size exceeded");
  const artifact = decodeObject(raw);
  if (Object.keys(artifact).some((k) => !["version", "language", "files"].includes(k)))
    throw new Error("invalid compiled artifact");
  const version = intField(artifact, "version", 1n, 1n),
    actualLanguage = stringField(artifact, "language"),
    files = artifact.files;
  if (
    version !== 1n ||
    actualLanguage !== language ||
    !files ||
    typeof files !== "object" ||
    Array.isArray(files) ||
    files instanceof JsonNumber
  )
    throw new Error("invalid compiled artifact metadata");
  const entries = Object.entries(files);
  if (entries.length < 1 || entries.length > 256)
    throw new Error("invalid compiled artifact metadata");
  const entry =
    language === "java"
      ? "Main.class"
      : language === "typescript"
        ? "main.js"
        : language === "ocaml"
          ? "main.byte"
          : undefined;
  if (!entry) throw new Error("unsupported compiled artifact");
  if (!Object.hasOwn(files, entry)) throw new Error("compiled artifact entrypoint missing");
  let total = 0;
  for (const [name, value] of entries) {
    if (
      !name ||
      new TextEncoder().encode(name).length > 255 ||
      name.startsWith(".") ||
      /[/\\\0]/.test(name)
    )
      throw new Error("invalid compiled artifact path");
    if (language === "java" ? !name.endsWith(".class") || name.length <= 6 : name !== entry)
      throw new Error("unexpected compiled artifact");
    if (typeof value !== "string") throw new Error("invalid compiled artifact encoding");
    const data = value.replace(/[\r\n]/g, "");
    let decoded: string;
    try {
      decoded = atob(data);
      if (btoa(decoded) !== data) throw new Error("noncanonical base64");
    } catch {
      throw new Error("invalid compiled artifact encoding");
    }
    total += decoded.length;
    if (total > maxArtifactBytes) throw new Error("compiled artifact size exceeded");
  }
}
