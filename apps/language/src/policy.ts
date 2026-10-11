/** @file policy.ts @description Development identity and document boundaries. @module language */
export const documentUri = "file:///workspace/main.py";
const allowedUris = new Set([documentUri, "file:///workspace", "file:///workspace/"]);
const methods = new Set([
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

/** Resolve a loopback-only development owner. @returns Owner or null for unauthorized upgrades. */
export function authorizeUpgrade(
  address: string | undefined,
  origin: string | undefined,
  url: URL,
): string | null {
  const local = address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
  const allowedOrigin = origin === "http://localhost:5173" || origin === "http://127.0.0.1:5173";
  const owner = url.searchParams.get("user");
  if (!local || !allowedOrigin || url.pathname !== "/lsp") return null;
  return owner === "alice" || owner === "bob" ? owner : null;
}

/** Validate JSON-RPC methods and virtual document paths. @returns Parsed message. */
export function validateMessage(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid JSON-RPC message");
  const message = value as Record<string, unknown>;
  if (message.jsonrpc !== "2.0") throw new Error("Invalid JSON-RPC version");
  if (
    message.method !== undefined &&
    (typeof message.method !== "string" || !methods.has(message.method))
  ) {
    throw new Error("Unsupported language method");
  }
  inspectUris(message.params);
  return message;
}

function inspectUris(value: unknown): void {
  if (Array.isArray(value)) {
    for (const child of value) inspectUris(child);
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
      inspectUris(child);
    }
  }
}
