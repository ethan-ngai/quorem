import { IdentityError } from './model.ts';

export function bearer(headers: Headers): string | undefined {
  if (headers.has('authorization')) {
    const value = headers.get('authorization') ?? '';
    if (!/^Bearer [^\s,]+$/.test(value)) throw new IdentityError('unauthorized');
    return value.slice(7);
  }
  let result: string | undefined;
  for (const item of (headers.get('sec-websocket-protocol') ?? '').split(',')) {
    const protocol = item.trim();
    if (protocol.startsWith('bearer.')) {
      const token = protocol.slice(7);
      if (!token || result !== undefined || /\s/.test(token)) throw new IdentityError('unauthorized');
      result = token;
    }
  }
  return result;
}
