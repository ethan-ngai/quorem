/** @file policy.ts @description Development identity and document boundaries. @module language */
import { z } from "zod";

export const documentUri = "file:///workspace/main.py";
const allowedUris = new Set([documentUri, "file:///workspace", "file:///workspace/"]);
const languageMethod = z.enum([
  "initialize",
  "initialized",
  "shutdown",
  "exit",
  "textDocument/didOpen",
  "textDocument/didChange",
  "textDocument/didClose",
  "textDocument/didSave",
  "textDocument/completion",
  "completionItem/resolve",
  "textDocument/hover",
  "textDocument/signatureHelp",
  "$/cancelRequest",
]);
const languageMessage = z.looseObject({
  jsonrpc: z.literal("2.0"),
  method: languageMethod.optional(),
  params: z.unknown().optional(),
});

/** Resolve a loopback-only development owner. @returns Owner or null for unauthorized upgrades. */
export function authorizeUpgrade(
  address: string | undefined,
  origin: string | undefined,
  url: URL,
  configuredOrigin?: string,
): string | null {
  const local = address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
  let localOrigin = false;
  if (configuredOrigin) {
    try {
      const configured = new URL(configuredOrigin);
      localOrigin =
        configured.origin === configuredOrigin &&
        configured.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(configured.hostname) &&
        origin === configuredOrigin;
    } catch {
      localOrigin = false;
    }
  }
  const allowedOrigin =
    localOrigin || origin === "http://localhost:5173" || origin === "http://127.0.0.1:5173";
  const owner = url.searchParams.get("user");
  if (!local || !allowedOrigin || url.pathname !== "/lsp") return null;
  return owner && ["alice", "bob", "charlie", "dana"].includes(owner) ? owner : null;
}

/** Validate JSON-RPC methods and virtual document paths. @returns Parsed message. */
export function validateMessage(text: string): Record<string, unknown> {
  const parsed = languageMessage.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error("Invalid language message");
  const message = parsed.data;
  inspectUris(message.params);
  return message;
}

function inspectUris(value: unknown, depth = 0): void {
  if (depth > 100) throw new Error("Language message nesting exceeds limit");
  if (Array.isArray(value)) {
    for (const child of value) inspectUris(child, depth + 1);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (
        (key === "uri" || key === "rootUri") &&
        typeof child === "string" &&
        !allowedUris.has(child)
      ) {
        throw new Error("Document outside language workspace");
      }
      if (key === "rootPath" && child !== null && child !== "/workspace") {
        throw new Error("Invalid workspace root");
      }
      inspectUris(child, depth + 1);
    }
  }
}

/** Managed credentials never fall back to fixture ownership. */
export function hasManagedCredentials(
  authorization: string | undefined,
  protocols: string | undefined,
): boolean {
  return (
    authorization !== undefined ||
    (protocols?.split(",").some((value) => value.trim().startsWith("bearer.")) ?? false)
  );
}
