export class IdentityError extends Error {
  constructor(readonly kind: 'unauthorized' | 'unavailable', cause?: unknown) { super(kind, { cause }); }
}
export interface Claims {
  issuer: string; subject: string; sessionId: string; emailVerified: true;
  name: string; image: string; color: number; colorRevision: bigint;
}
export interface Principal {
  userId: string; displayName: string; admin: boolean; emailVerified: boolean;
  sessionId: string; strongUntil: number;
}
export interface IdentityBindings {
  lookup(claims: Claims): Promise<{ principal: Principal; current: boolean } | null>;
  resolve(claims: Claims): Promise<Principal>;
}
export interface SessionAuthority {
  check(sessionId: string, subject: string, signal?: AbortSignal): Promise<{ strongAt?: number }>;
}
export interface TokenVerifier { verify(token: string, signal?: AbortSignal): Promise<Claims> }

export async function authenticate(token: string, verifier: TokenVerifier, authority: SessionAuthority, bindings: IdentityBindings, signal?: AbortSignal): Promise<Principal> {
  const claims = await verifier.verify(token, signal);
  const session = await authority.check(claims.sessionId, claims.subject, signal);
  let principal: Principal;
  try {
    const existing = await bindings.lookup(claims);
    principal = existing?.current ? existing.principal : await bindings.resolve(claims);
  } catch (error) {
    if (error instanceof IdentityError) throw error;
    throw new IdentityError('unavailable', error);
  }
  const now = Math.floor(Date.now() / 1000);
  const strongAt = session.strongAt;
  return { ...principal, strongUntil: strongAt !== undefined && Number.isSafeInteger(strongAt) && strongAt <= now && strongAt > now - 600 ? strongAt + 600 : 0 };
}
