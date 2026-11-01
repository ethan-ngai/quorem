/** @file identity.ts @description Managed session authorization through the API authority. @module language */
export class IdentityUnavailable extends Error {
  constructor() {
    super("Identity service unavailable");
  }
}

/** API session owns bearer verification, revocation and hosted-intelligence entitlement. */
export async function managedOwner(
  protocol: string | undefined,
  origin: string | undefined,
  path: string,
): Promise<string | null> {
  if (!process.env.AUTH_ORIGIN || origin !== process.env.AUTH_ORIGIN || path !== "/lsp")
    return null;
  const tokens = (protocol ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("bearer."));
  if (tokens.length !== 1) return null;
  const bearer = tokens[0]!.slice(7);
  if (!bearer || bearer.length > 16384 || /\s/.test(bearer) || !process.env.API_IDENTITY_URL)
    return null;
  try {
    const endpoint = new URL(process.env.API_IDENTITY_URL);
    endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, "")}/v1/session`;
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${bearer}` },
      redirect: "error",
      signal: AbortSignal.timeout(3000),
    });
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok || !response.body) throw new IdentityUnavailable();
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0,
      text = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 65536) {
          await reader.cancel();
          throw new IdentityUnavailable();
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    const data = JSON.parse(text) as {
      mode?: string;
      kind?: string;
      user?: { id?: string; emailVerified?: boolean };
      capabilities?: { hostedIntelligence?: boolean };
    };
    if (
      data.mode !== "managed" ||
      data.kind !== "account" ||
      data.user?.emailVerified !== true ||
      data.capabilities?.hostedIntelligence !== true ||
      typeof data.user.id !== "string" ||
      !data.user.id
    )
      return null;
    return data.user.id;
  } catch {
    throw new IdentityUnavailable();
  }
}
