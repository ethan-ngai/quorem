/** @file credentials.ts @description Guest credential parsing and precedence. @module identity */
import { bearer } from '../credentials.ts';
import { IdentityError, type GuestPrincipal, type ManagedPrincipal, type LocalPrincipal, type Principal } from '../model.ts';

export type GuestKind = 'match' | 'interview';
export class GuestOriginDenied extends Error {}
export function guestOriginAllowed(method: string, origin: string | null, allowedOrigins: readonly string[]): boolean {
  return origin === null ? method === 'GET' : allowedOrigins.includes(origin);
}
export interface GuestIdentityReader { lookup(kind: GuestKind, tokenHash: string): Promise<GuestPrincipal | null> }
export function guestCookieName(kind: GuestKind): string { return kind === 'match' ? 'quorem_guest' : 'quorem_interview_guest'; }
export function guestCookie(headers: Headers, kind: GuestKind): string | undefined {
  const name = guestCookieName(kind);
  let value: string | undefined;
  for (const entry of (headers.get('cookie') ?? '').split(';')) {
    const index = entry.indexOf('=');
    if (index < 0 || entry.slice(0, index).trim() !== name) continue;
    if (value !== undefined) throw new IdentityError('unauthorized');
    value = entry.slice(index + 1).trim();
  }
  return value;
}
export function validGuestToken(token: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  try {
    const bytes = atob(token.replaceAll('-', '+').replaceAll('_', '/') + '=');
    return bytes.length === 32 && btoa(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') === token;
  } catch { return false; }
}
export function newGuestToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export async function guestTokenHash(token: string): Promise<string> {
  if (!validGuestToken(token)) throw new IdentityError('unauthorized');
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export async function authenticateGuestRequest(headers: Headers, kind: GuestKind, managed: (token: string) => Promise<ManagedPrincipal | LocalPrincipal>, guests: GuestIdentityReader, policy: { method: string; allowedOrigins: readonly string[] }): Promise<Principal | null> {
  const credential = bearer(headers);
  if (credential !== undefined) return managed(credential);
  const token = guestCookie(headers, kind);
  if (token === undefined) return null;
  if (!guestOriginAllowed(policy.method, headers.get('origin'), policy.allowedOrigins)) throw new GuestOriginDenied();
  const hash = await guestTokenHash(token);
  try {
    const principal = await guests.lookup(kind, hash);
    if (!principal || principal.kind !== 'guest' || principal.scope.kind !== kind) throw new IdentityError('unauthorized');
    return principal;
  } catch (error) {
    if (error instanceof IdentityError) throw error;
    throw new IdentityError('unavailable', error);
  }
}
