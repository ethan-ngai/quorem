/** @file grant.ts @description Reauthorize verified socket grants without retaining credentials. @module identity */
import {
  IdentityError,
  type Claims,
  type GuestPrincipal,
  type ManagedPrincipal,
  type SessionAuthority,
} from "./model.ts";

/** Stored only in trusted server storage; never sent to a browser or socket attachment. */
export type ManagedGrant = Pick<Claims, "issuer" | "subject" | "sessionId" | "expiresAt"> & {
  kind: "managed";
};
export type GuestGrant = {
  kind: "guest";
  scope: "match" | "interview";
  resourceId: string;
  hash: string;
  expiresAt: number;
};
export type InviteGrant = { kind: "invite"; resourceId: string; hash: string; expiresAt: number };
export type VerifiedGrant = ManagedGrant | GuestGrant | InviteGrant;
export interface GrantReaders {
  sessions: SessionAuthority;
  managed(grant: ManagedGrant): Promise<ManagedPrincipal | null>;
  guest(kind: GuestGrant["scope"], hash: string): Promise<GuestPrincipal | null>;
  invite(resourceId: string, hash: string): Promise<boolean>;
}
/** Only call after token verification; profile claims and bearer bytes are deliberately discarded. */
export function managedGrant(claims: Claims): ManagedGrant {
  return {
    kind: "managed",
    issuer: claims.issuer,
    subject: claims.subject,
    sessionId: claims.sessionId,
    expiresAt: claims.expiresAt,
  };
}
/** Every wake rechecks the original expiry and current authoritative session and binding. */
export async function reauthorizeGrant(
  grant: VerifiedGrant,
  readers: GrantReaders,
  now = Date.now(),
  signal?: AbortSignal,
): Promise<ManagedPrincipal | GuestPrincipal | undefined> {
  if (!Number.isSafeInteger(grant.expiresAt) || grant.expiresAt * 1000 <= now)
    throw new IdentityError("unauthorized");
  try {
    if (grant.kind === "managed") {
      const session = await readers.sessions.check(grant.sessionId, grant.subject, signal);
      const principal = await readers.managed(grant);
      if (!principal || principal.kind !== "managed" || principal.sessionId !== grant.sessionId)
        throw new IdentityError("unauthorized");
      const seconds = Math.floor(now / 1000);
      const strongAt = session.strongAt;
      return {
        ...principal,
        credentialExpiresAt: grant.expiresAt,
        strongUntil:
          strongAt !== undefined &&
          Number.isSafeInteger(strongAt) &&
          strongAt <= seconds &&
          strongAt > seconds - 600
            ? strongAt + 600
            : 0,
      };
    }
    if (grant.kind === "guest") {
      const principal = await readers.guest(grant.scope, grant.hash);
      const scopeId =
        principal?.scope.kind === "match" ? principal.scope.matchId : principal?.scope.interviewId;
      if (
        !principal ||
        principal.scope.kind !== grant.scope ||
        scopeId !== grant.resourceId ||
        principal.sessionId !== grant.hash
      )
        throw new IdentityError("unauthorized");
      return {
        ...principal,
        credentialExpiresAt: Math.min(principal.credentialExpiresAt, grant.expiresAt),
      };
    }
    if (grant.kind === "invite" && (await readers.invite(grant.resourceId, grant.hash)))
      return undefined;
    throw new IdentityError("unauthorized");
  } catch (error) {
    if (error instanceof IdentityError) throw error;
    throw new IdentityError("unavailable", error);
  }
}
