import { IdentityError, type SessionAuthority } from '../../modules/identity/model.ts';
import { serviceURL } from './service-url.ts';

export function httpSessionAuthority(options: { baseURL: string; secret: string; fetch?: typeof fetch }): SessionAuthority {
  const base = serviceURL(options.baseURL, true);
  if (!options.secret) throw new Error('Invalid session authority configuration');
  const fetcher = options.fetch ?? fetch;
  return { async check(sessionId, subject, signal) {
    try {
      const response = await fetcher(new URL(`/internal/session/${encodeURIComponent(sessionId)}`, base), {
        headers: { Authorization: `Bearer ${options.secret}`, 'X-Auth-Subject': subject },
        redirect: 'manual', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000),
      });
      await response.body?.cancel();
      if (response.status === 401 || response.status === 403) throw new IdentityError('unauthorized');
      if (response.status !== 204) throw new IdentityError('unavailable');
      const raw = response.headers.get('X-Auth-Strong-At');
      return raw && /^\d+$/.test(raw) ? { strongAt: Number(raw) } : {};
    } catch (error) {
      if (error instanceof IdentityError) throw error;
      throw new IdentityError('unavailable', error);
    }
  } };
}
