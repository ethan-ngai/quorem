/** Managed ownership delegates to the API verifier, including live session/disable checks. */
export async function managedOwner(
  protocol: string | undefined,
  origin: string | undefined,
  path: string,
): Promise<string | null> {
  if (!process.env.AUTH_ORIGIN || origin !== process.env.AUTH_ORIGIN || path !== "/lsp")
    return null;
  const bearer = protocol
    ?.split(",")
    .map((part) => part.trim())
    .find((part) => part.startsWith("bearer."))
    ?.slice(7);
  if (!bearer || bearer.length > 16384 || !process.env.API_IDENTITY_URL) return null;
  try {
    const response = await fetch(`${process.env.API_IDENTITY_URL}/v1/session`, {
      headers: { Authorization: `Bearer ${bearer}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      user?: { id?: string; emailVerified?: boolean };
      mode?: string;
      capabilities?: { hostedIntelligence?: boolean };
    };
    return data.capabilities?.hostedIntelligence === true &&
      data.mode === "managed" &&
      data.user?.emailVerified === true &&
      data.user.id
      ? data.user.id
      : null;
  } catch {
    return null;
  }
}
