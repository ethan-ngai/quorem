/** @file mail-crypto.ts @description Authenticated encryption for mail intents. @module auth */
const encoder = new TextEncoder();
const decoder = new TextDecoder();
export async function digest(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function opaque(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export function mailCipher(key: Uint8Array) {
  if (key.byteLength !== 32) throw new Error('Mail intent key must be 32 bytes');
  const imported = crypto.subtle.importKey('raw', new Uint8Array(key), 'AES-GCM', false, ['encrypt', 'decrypt']);
  const aad = (id: string, purpose: string, generation: number) => encoder.encode(JSON.stringify([id, purpose, generation]));
  return {
    async encrypt(id: string, purpose: string, generation: number, value: object) {
      const nonce = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad(id, purpose, generation) }, await imported, encoder.encode(JSON.stringify(value)));
      return { nonce: Buffer.from(nonce), ciphertext: Buffer.from(ciphertext) };
    },
    async decrypt(id: string, purpose: string, generation: number, nonce: Uint8Array, ciphertext: Uint8Array): Promise<unknown> {
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(nonce), additionalData: aad(id, purpose, generation) }, await imported, new Uint8Array(ciphertext));
      return JSON.parse(decoder.decode(plaintext));
    },
  };
}
