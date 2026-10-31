/** @file session.ts @description Match guest session read and end reconciliation. @module identity */
import { IdentityError, type GuestPrincipal } from '../model.ts';
import type { GuestIdentityReader } from './credentials.ts';
export type MatchGuestSession = { kind: 'active'; principal: GuestPrincipal } | { kind: 'ended' };
export async function readMatchGuestSession(principal: GuestPrincipal, sessions: GuestIdentityReader & { endMatch(hash: string): Promise<boolean> }): Promise<MatchGuestSession> {
  if (principal.scope.kind !== 'match') throw new IdentityError('unauthorized');
  try {
    if (await sessions.endMatch(principal.sessionId)) return { kind: 'ended' };
    const current = await sessions.lookup('match', principal.sessionId);
    if (!current || current.scope.kind !== 'match') throw new IdentityError('unauthorized');
    return { kind: 'active', principal: current };
  } catch (error) {
    if (error instanceof IdentityError) throw error;
    throw new IdentityError('unavailable', error);
  }
}
