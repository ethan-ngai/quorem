import { compactVerify, decodeJwt, decodeProtectedHeader, importJWK, type JWK } from 'jose';
import { IdentityError, type Claims, type TokenVerifier } from '../../modules/identity/model.ts';
import { serviceURL } from './service-url.ts';

export function jwtVerifier(options: { issuer: string; audience: string; jwksURL: string; fetch?: typeof fetch }): TokenVerifier {
  serviceURL(options.issuer, true);
  const url = serviceURL(options.jwksURL, false);
  if (!options.audience) throw new Error('Invalid JWT configuration');
  const fetcher = options.fetch ?? fetch;
  let keys = new Map<string, CryptoKey>();
  let fetched = 0, attempted = 0;
  let lastError: IdentityError | undefined;
  let pending: Promise<void> | undefined;
  async function refresh(signal?: AbortSignal) {
    attempted = Date.now();
    try {
      const response = await fetcher(url, { redirect: 'manual', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000) });
      if (response.status !== 200 || Number(response.headers.get('content-length')) > 65536 || !response.body) {
        await response.body?.cancel();
        throw new Error('JWKS unavailable');
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 65536) { await reader.cancel(); throw new Error('JWKS too large'); } chunks.push(part.value); }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (!data || typeof data !== 'object' || !('keys' in data) || !Array.isArray(data.keys) || data.keys.length > 20) throw new Error('Invalid JWKS');
      const next = new Map<string, CryptoKey>();
      for (const value of data.keys) {
        if (!value || typeof value !== 'object') continue;
        const jwk = value as JWK;
        if (typeof jwk.kid !== 'string' || !jwk.kid || jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || (jwk.alg && jwk.alg !== 'EdDSA')) continue;
        try { const key = await importJWK(jwk, 'EdDSA'); if (key instanceof CryptoKey) next.set(jwk.kid, key); } catch { /* Ignore unusable keys. */ }
      }
      keys = next; fetched = Date.now(); lastError = undefined;
    } catch (error) {
      lastError = new IdentityError('unavailable', error);
      throw lastError;
    }
  }
  async function key(kid: string, signal?: AbortSignal) {
    const cached = keys.get(kid);
    if (cached && Date.now() - fetched < 300000) return cached;
    if (pending) await pending;
    else if (Date.now() - attempted >= 1000) {
      pending = refresh(signal); try { await pending; } finally { pending = undefined; }
    } else if (lastError) throw lastError;
    const found = keys.get(kid);
    if (!found) throw new IdentityError('unauthorized');
    return found;
  }
  return { async verify(token, signal): Promise<Claims> {
    if (new TextEncoder().encode(token).length > 16384) throw new IdentityError('unauthorized');
    try {
      const header = decodeProtectedHeader(token);
      if (header.alg !== 'EdDSA' || typeof header.kid !== 'string' || !header.kid) throw new IdentityError('unauthorized');
      const claims = decodeJwt(token);
      const now = Math.floor(Date.now()/1000);
      if (claims.iss !== options.issuer || claims.aud !== options.audience || typeof claims.sub !== 'string' || !claims.sub || typeof claims.sessionId !== 'string' || !claims.sessionId || claims.emailVerified !== true || !Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.iat) || claims.exp! <= now || claims.iat! <= 0 || claims.iat! > now + 30 || claims.exp! - claims.iat! > 300) throw new IdentityError('unauthorized');
      if (claims.color !== undefined && !Number.isSafeInteger(claims.color)) throw new IdentityError('unauthorized');
      if (claims.colorRevision !== undefined && !Number.isSafeInteger(claims.colorRevision)) throw new IdentityError('unauthorized');
      if (claims.name !== undefined && typeof claims.name !== 'string' || claims.image !== undefined && typeof claims.image !== 'string') throw new IdentityError('unauthorized');
      await compactVerify(token, await key(header.kid, signal), { algorithms: ['EdDSA'] });
      return { issuer: claims.iss, subject: claims.sub, sessionId: claims.sessionId, emailVerified: true, name: (claims.name as string | undefined) ?? '', image: (claims.image as string | undefined) ?? '', color: (claims.color as number | undefined) ?? 0, colorRevision: BigInt((claims.colorRevision as number | undefined) ?? 0) };
    } catch (error) { if (error instanceof IdentityError) throw error; throw new IdentityError('unauthorized', error); }
  } };
}
