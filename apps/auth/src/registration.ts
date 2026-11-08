/** @file registration.ts @description Email ownership and credential setup. @module auth */
import { hashPassword } from 'better-auth/crypto';
import { accountSetupSchema, registrationProofSchema, registrationStartSchema } from '@quorem/contracts/auth';
import { digest, opaque } from './mail-crypto.ts';
import { MailRateLimited, type MailRepository } from './mail-repository.ts';
import type { MailIntentService } from './mail-intent.ts';
import { validPeer } from './peer.ts';

const cookieName = 'quorem_registration';
const json = (status: number, body: object, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });
export function createRegistrationHandler(options: { repository: MailRepository; mail: MailIntentService; origin: string }) {
  const { repository, mail, origin } = options;
  const cookie = (value: string, age = 900) => `${cookieName}=${value}; Path=/api/auth/registration; HttpOnly; SameSite=Strict; Max-Age=${age}${origin.startsWith('https:') ? '; Secure' : ''}`;
  return async (request: Request): Promise<Response | undefined> => {
    const path = new URL(request.url).pathname;
    if (!path.startsWith('/api/auth/registration/')) return;
    const action = path.slice('/api/auth/registration/'.length);
    if (!['status', 'start', 'verify', 'complete'].includes(action)) return json(404, { message: 'Not found' });
    const grant = request.headers.get('cookie')?.split(';').map((value) => value.trim()).find((value) => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) ?? '';
    if (action === 'status' && request.method === 'GET') {
      const found = await repository.status(await digest(grant));
      return found ? json(200, found) : json(401, { message: 'This setup link expired. Request a new email.' });
    }
    if (action === 'status' || request.method !== 'POST') return json(405, { message: 'Method not allowed' });
    if (request.headers.get('origin') !== origin) return json(403, { message: 'Invalid origin' });
    const peer = validPeer(request.headers.get('x-quorem-peer-ip')) ?? 'missing';
    const limit = await repository.rateLimit(`registration:requests:${action}`, peer, 60, 60);
    if (!limit.allowed) return json(429, { message: 'Too many attempts. Try again shortly.' }, { 'Retry-After': String(limit.retryAfter) });
    if (Number(request.headers.get('content-length')) > 4096) return json(413, { message: 'Request too large' });
    const reader = request.body?.getReader();
    let raw = '', size = 0;
    const decoder = new TextDecoder();
    if (reader) while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); return json(413, { message: 'Request too large' }); }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    let body: unknown;
    try { body = JSON.parse(raw); }
    catch { return json(400, { message: 'Invalid request' }); }
    if (action === 'start') {
      const parsed = registrationStartSchema.safeParse(body);
      if (!parsed.success) return json(400, { message: 'Enter a valid email address.' });
      const token = opaque();
      const link = new URL('/login', origin);
      if (parsed.data.callbackURL) {
        try { const callback = new URL(parsed.data.callbackURL, origin); if (callback.origin === origin && callback.pathname === '/login') link.search = callback.search; } catch { /* Invalid callbacks are ignored. */ }
      }
      link.searchParams.delete('verified'); link.searchParams.delete('setup'); link.searchParams.set('signupToken', token);
      try {
        const result = await mail.create('registration', { email: parsed.data.email, url: link.toString() }, await digest(token));
        if (result === 'rejected') return json(503, { message: 'Could not send your email. Please try again.' });
        if (result === 'uncertain') return json(503, { message: 'Could not confirm delivery. Check your email and wait before requesting another.' });
        return json(200, { retryAfter: 60 });
      } catch (error) {
        if (error instanceof MailRateLimited) return json(200, { retryAfter: error.retryAfter });
        return json(503, { message: 'Could not send your email. Please try again.' });
      }
    }
    if (action === 'verify') {
      const proof = registrationProofSchema.safeParse(body);
      if (!proof.success) return json(400, { message: 'This link is invalid. Request a new email.' });
      const next = opaque();
      return await repository.verify(await digest(proof.data.token), await digest(next)) ? json(200, {}, { 'Set-Cookie': cookie(next) }) : json(400, { message: 'This link expired or was already used. Request a new email.' });
    }
    if (action === 'complete') {
      const parsed = accountSetupSchema.safeParse(body);
      if (!parsed.success) return json(400, { message: parsed.error.issues[0].message });
      try {
        const grantHash = await digest(grant);
        if (!grant || !(await repository.status(grantHash))) return json(401, { message: 'Your setup session expired. Request a new email.' });
        const result = await repository.complete({ ...parsed.data, grantHash, passwordHash: await hashPassword(parsed.data.password) });
        if (result === 'ok') return json(200, {}, { 'Set-Cookie': cookie('', 0) });
        if (result === 'expired') return json(401, { message: 'Your setup session expired. Request a new email.' });
        if (result === 'mismatch') return json(409, { message: 'Account setup changed in another tab. Open your email link again.' });
        if (result === 'registered') return json(409, { message: 'Your account is ready. Sign in instead.' });
        return json(409, { message: 'That username is taken. Choose another.' });
      } catch { return json(503, { message: 'Could not finish setup. Please try again.' }); }
    }
    return json(404, { message: 'Not found' });
  };
}
