/** @file guest.ts @description Scoped guest access and public admission. @module access */
import { IdentityError, type GuestPrincipal } from '../identity/model.ts';
export function guestMayAccess(principal: GuestPrincipal, scope: { kind: 'match' | 'interview'; id: string }): boolean {
  return principal.scope.kind === scope.kind && (principal.scope.kind === 'match' ? principal.scope.matchId : principal.scope.interviewId) === scope.id;
}
export interface GuestRequestBudget { allow(peer: string): Promise<boolean> }
export function requireTrustedPeer(peer: string | undefined): string {
  if (!peer || peer.length > 256 || Array.from(peer).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new IdentityError('unavailable');
  return peer;
}
export async function allowPublicGuestRequest(peer: string | undefined, budget: GuestRequestBudget): Promise<boolean> {
  const trusted = requireTrustedPeer(peer);
  try { return await budget.allow(trusted); } catch (error) { throw new IdentityError('unavailable', error); }
}
/** Path allowlist precedes object-level ownership checks. */
export function matchGuestRouteAllowed(principal: GuestPrincipal, method: string, path: string, isPublic: boolean): boolean {
  if (isPublic) return true;
  if (principal.scope.kind !== 'match') return false;
  if (method === 'POST' && path === '/v1/guest-sessions/end') return true;
  if (method === 'GET' && (['/v1/session', '/v1/matches/current', '/v1/memberships/events'].includes(path) || path.startsWith('/v1/workspaces/') || path.startsWith('/v1/submissions/'))) return true;
  if (method === 'POST' && (path === '/v1/submissions' || (path.startsWith('/v1/submissions/') && path.endsWith('/cancel')))) return true;
  const base = `/v1/matches/${principal.scope.matchId}`;
  return (method === 'GET' && path === base) || ['/events', '/ready', '/leave', '/forfeit', '/rule-events', '/workspace-language'].some((suffix) => path === base + suffix);
}
