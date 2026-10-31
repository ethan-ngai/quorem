/** @file mail-intent.ts @description Durable encrypted mail delivery. @module auth */
import { MailRejected, type VerificationSender } from './email-delivery.ts';
export { MailRejected } from './email-delivery.ts';
import { mailCipher } from './mail-crypto.ts';
import type { MailRepository } from './mail-repository.ts';

export class MailUncertain extends Error {}
type Payload = { email: string; url: string; subject?: string; instruction?: string };
export function createMailIntentService(options: { repository: MailRepository; key: Uint8Array; deliver: VerificationSender }) {
  const cipher = mailCipher(options.key);
  async function dispatch(id: string): Promise<'accepted' | 'rejected' | 'uncertain'> {
    let item;
    try { item = await options.repository.claim(id); } catch { return 'uncertain'; }
    if (!item) return 'uncertain';
    let result: 'accepted' | 'rejected' | 'uncertain' = 'uncertain';
    let email: string | undefined;
    try {
      const payload = await cipher.decrypt(item.id, item.purpose, item.generation, item.nonce, item.ciphertext);
      if (!payload || typeof payload !== 'object' || !('email' in payload) || typeof payload.email !== 'string' || !('url' in payload) || typeof payload.url !== 'string') throw new MailRejected('Invalid intent');
      const data = payload as Payload;
      email = data.email;
      await options.deliver(data.email, data.url, data.subject && data.instruction ? { subject: data.subject, instruction: data.instruction } : undefined);
      result = 'accepted';
    } catch (error) { result = error instanceof MailRejected ? 'rejected' : 'uncertain'; }
    try { return await options.repository.acknowledge(item, result, email) ? result : 'uncertain'; }
    catch { return 'uncertain'; }
  }
  return {
    async create(purpose: 'registration' | 'account', payload: Payload, tokenHash?: string) {
      const id = crypto.randomUUID();
      await options.repository.create({ id, purpose, email: payload.email, lane: purpose === 'account' ? payload.subject : undefined, tokenHash, encrypt: (generation) => cipher.encrypt(id, purpose, generation, payload) });
      return dispatch(id);
    },
    dispatch,
  };
}
export type MailIntentService = ReturnType<typeof createMailIntentService>;
