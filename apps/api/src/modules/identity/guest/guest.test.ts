/** @file guest.test.ts @description Guest transport and policy conformance. @module identity */
import { describe, expect, it } from 'vitest';
import { createApp } from '../../../app.ts';
import { IdentityError, type GuestPrincipal } from '../model.ts';
import { authenticateGuestRequest, guestCookie, guestTokenHash, newGuestToken, validGuestToken, GuestOriginDenied } from './credentials.ts';
import { guestRoutes } from './routes.ts';
import { readMatchGuestSession } from './session.ts';
import { allowPublicGuestRequest, guestMayAccess, matchGuestRouteAllowed } from '../../access/guest.ts';

const origin = 'https://quorem.test';
const token = newGuestToken();
const principal: GuestPrincipal = { kind: 'guest', userId: 'guest', displayName: 'Guest', admin: false, emailVerified: false, sessionId: 'hash', strongUntil: 0, credentialExpiresAt: 9999999999, scope: { kind: 'match', matchId: 'm1' } };
const guests = { lookup: async () => principal, endMatch: async () => true };
const managed = async () => { throw new IdentityError('unauthorized'); };
const app = (budget = { allow: async () => true }) => createApp({ allowedOrigins: [origin], requestId: () => 'request' }).route('/', guestRoutes({ allowedOrigins: [origin], admissionEnabled: true, trustedPeer: () => '127.0.0.1', budget, guests, managed }));

describe('guest credential and policy', () => {
  it('issues canonical opaque tokens, hashes consistently and rejects duplicates', async () => {
    expect(validGuestToken(token)).toBe(true);
    expect(validGuestToken(`${token}x`)).toBe(false);
    expect(await guestTokenHash(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(await guestTokenHash(token)).toBe(await guestTokenHash(token));
    expect(await guestTokenHash('A'.repeat(43))).toBe('0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a');
    expect(() => guestCookie(new Headers({ cookie: `quorem_guest=${token}; quorem_guest=${token}` }), 'match')).toThrow(IdentityError);
  });
  it('never falls back to cookies after bearer or websocket credential failure', async () => {
    for (const [name, value] of [['authorization', 'Bearer invalid'], ['authorization', 'Basic invalid'], ['sec-websocket-protocol', 'bearer.one, bearer.two']]) {
      const headers = new Headers({ cookie: `quorem_guest=${token}` }); headers.set(name, value);
      await expect(authenticateGuestRequest(headers, 'match', managed, guests, { method: 'GET', allowedOrigins: [origin] })).rejects.toBeInstanceOf(IdentityError);
    }
    const account = { kind: 'local' as const, userId: 'account', displayName: 'Account', admin: false, emailVerified: true, sessionId: 'local', strongUntil: 0 };
    expect(await authenticateGuestRequest(new Headers({ cookie: `quorem_guest=${token}`, 'sec-websocket-protocol': 'quorem, bearer.valid' }), 'match', async () => account, guests, { method: 'GET', allowedOrigins: [origin] })).toEqual(account);
    expect(await authenticateGuestRequest(new Headers({ cookie: `quorem_guest=${token}` }), 'interview', managed, guests, { method: 'GET', allowedOrigins: [origin] })).toBeNull();
    await expect(authenticateGuestRequest(new Headers({ cookie: `quorem_interview_guest=${token}` }), 'interview', managed, guests, { method: 'GET', allowedOrigins: [origin] })).rejects.toBeInstanceOf(IdentityError);
    await expect(authenticateGuestRequest(new Headers({ cookie: `quorem_guest=${token}` }), 'match', managed, guests, { method: 'POST', allowedOrigins: [origin] })).rejects.toBeInstanceOf(GuestOriginDenied);
    await expect(authenticateGuestRequest(new Headers({ cookie: `quorem_guest=${token}`, origin: 'https://evil.test' }), 'match', managed, guests, { method: 'GET', allowedOrigins: [origin] })).rejects.toBeInstanceOf(GuestOriginDenied);
    expect((await authenticateGuestRequest(new Headers({ cookie: `quorem_guest=${token}`, origin }), 'match', managed, guests, { method: 'POST', allowedOrigins: [origin] }))?.kind).toBe('guest');
    expect(guestMayAccess(principal, { kind: 'match', id: 'm1' })).toBe(true);
    expect(guestMayAccess(principal, { kind: 'match', id: 'm2' })).toBe(false);
    expect(guestMayAccess(principal, { kind: 'interview', id: 'm1' })).toBe(false);
    expect(matchGuestRouteAllowed(principal, 'GET', '/v1/matches/m1', false)).toBe(true);
    expect(matchGuestRouteAllowed(principal, 'GET', '/v1/matches/m2', false)).toBe(false);
    expect(matchGuestRouteAllowed(principal, 'POST', '/v1/admin/questions', false)).toBe(false);
  });
  it('fails closed for missing peer and budget outage', async () => {
    await expect(allowPublicGuestRequest(undefined, { allow: async () => true })).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(allowPublicGuestRequest('peer', { allow: async () => { throw Error('down'); } })).rejects.toMatchObject({ kind: 'unavailable' });
  });
  it('bootstraps with origin, no-store, request ID and secure cookie', async () => {
    const response = await app().request('/v1/guest-sessions', { method: 'POST', headers: { origin } });
    expect(response.status).toBe(204);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toBe('request');
    expect(response.headers.get('set-cookie')).toMatch(/^quorem_guest=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=86400; Secure$/);
    const localOrigin = 'http://localhost:5173';
    const local = createApp({ allowedOrigins: [localOrigin], requestId: () => 'local' }).route('/', guestRoutes({ allowedOrigins: [localOrigin], admissionEnabled: true, trustedPeer: () => '127.0.0.1', budget: { allow: async () => true }, guests, managed }));
    const localResponse = await local.request('/v1/guest-sessions', { method: 'POST', headers: { origin: localOrigin } });
    expect(localResponse.headers.get('set-cookie')).not.toContain('Secure');
    expect((await app().request('/v1/guest-sessions', { method: 'POST' })).status).toBe(403);
    expect((await app({ allow: async () => false }).request('/v1/guest-sessions', { method: 'POST', headers: { origin } })).status).toBe(429);
    expect((await app().request('/v1/guest-sessions', { method: 'POST', headers: { origin, authorization: 'Bearer invalid', cookie: `quorem_guest=${token}` } })).status).toBe(401);
  });
  it('reconciles a match guest session without granting access on an outage', async () => {
    expect(await readMatchGuestSession(principal, { endMatch: async () => false, lookup: async () => principal })).toEqual({ kind: 'active', principal });
    expect(await readMatchGuestSession(principal, { endMatch: async () => true, lookup: async () => principal })).toEqual({ kind: 'ended' });
    await expect(readMatchGuestSession(principal, { endMatch: async () => { throw Error('down'); }, lookup: async () => principal })).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(readMatchGuestSession(principal, { endMatch: async () => false, lookup: async () => null })).rejects.toMatchObject({ kind: 'unauthorized' });
  });
  it('ends only the authenticated match session and clears its cookie', async () => {
    const response = await app().request('/v1/guest-sessions/end', { method: 'POST', headers: { origin, cookie: `quorem_guest=${token}` } });
    expect(response.status).toBe(204);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    const active = createApp({ allowedOrigins: [origin], requestId: () => 'active' }).route('/', guestRoutes({ allowedOrigins: [origin], admissionEnabled: true, trustedPeer: () => '127.0.0.1', budget: { allow: async () => true }, guests: { ...guests, endMatch: async () => false }, managed }));
    const conflict = await active.request('/v1/guest-sessions/end', { method: 'POST', headers: { origin, cookie: `quorem_guest=${token}` } });
    expect(conflict.status).toBe(409);
    expect(conflict.headers.has('set-cookie')).toBe(false);
    let lookups = 0;
    const expired = createApp({ allowedOrigins: [origin], requestId: () => 'expired' }).route('/', guestRoutes({ allowedOrigins: [origin], admissionEnabled: true, trustedPeer: () => '127.0.0.1', budget: { allow: async () => true }, guests: { lookup: async () => ++lookups === 1 ? principal : null, endMatch: async () => false }, managed }));
    expect((await expired.request('/v1/guest-sessions/end', { method: 'POST', headers: { origin, cookie: `quorem_guest=${token}` } })).status).toBe(401);
    expect((await app().request('/v1/guest-sessions/end', { method: 'POST', headers: { origin, cookie: `quorem_guest=${token}; quorem_guest=${token}` } })).status).toBe(401);
  });
});
