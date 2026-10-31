export class IdentityError extends Error {
  readonly kind: "unauthorized" | "unavailable";
  constructor(kind: "unauthorized" | "unavailable", cause?: unknown) {
    super(kind, { cause });
    this.kind = kind;
  }
}
export interface Claims {
  issuer: string;
  subject: string;
  sessionId: string;
  emailVerified: true;
  name: string;
  image: string;
  color: number;
  colorRevision: bigint;
  issuedAt: number;
  expiresAt: number;
}
interface PrincipalFields {
  userId: string;
  displayName: string;
  admin: boolean;
  emailVerified: boolean;
  sessionId: string;
  strongUntil: number;
}
export type ManagedPrincipal = PrincipalFields & { kind: "managed"; credentialExpiresAt: number };
export type LocalPrincipal = PrincipalFields & { kind: "local"; credentialExpiresAt?: never };
export type GuestScope = { kind: "match"; matchId: string } | { kind: "interview"; interviewId: string };
export type GuestPrincipal = PrincipalFields & { kind: "guest"; scope: GuestScope; admin: false; emailVerified: false; strongUntil: 0; credentialExpiresAt: number };
export type Principal = ManagedPrincipal | LocalPrincipal | GuestPrincipal;
export interface IdentityBindings {
  lookup(claims: Claims): Promise<{ principal: ManagedPrincipal; current: boolean } | null>;
  resolve(claims: Claims): Promise<ManagedPrincipal>;
}
export interface SessionAuthority {
  check(sessionId: string, subject: string, signal?: AbortSignal): Promise<{ strongAt?: number }>;
}
export interface TokenVerifier {
  verify(token: string, signal?: AbortSignal): Promise<Claims>;
}

export async function authenticate(
  token: string,
  verifier: TokenVerifier,
  authority: SessionAuthority,
  bindings: IdentityBindings,
  signal?: AbortSignal,
): Promise<ManagedPrincipal> {
  const claims = await verifier.verify(token, signal);
  const session = await authority.check(claims.sessionId, claims.subject, signal);
  let principal: ManagedPrincipal;
  try {
    const existing = await bindings.lookup(claims);
    principal = existing?.current ? existing.principal : await bindings.resolve(claims);
  } catch (error) {
    if (error instanceof IdentityError) throw error;
    throw new IdentityError("unavailable", error);
  }
  const now = Math.floor(Date.now() / 1000);
  if (claims.expiresAt <= now) throw new IdentityError("unauthorized");
  const strongAt = session.strongAt;
  return {
    ...principal,
    kind: "managed",
    credentialExpiresAt: claims.expiresAt,
    strongUntil:
      strongAt !== undefined &&
      Number.isSafeInteger(strongAt) &&
      strongAt <= now &&
      strongAt > now - 600
        ? strongAt + 600
        : 0,
  };
}
