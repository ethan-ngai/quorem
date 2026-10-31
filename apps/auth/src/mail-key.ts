/** Decode the explicitly configured AES-256 key without exposing it in configuration output. */
export function mailIntentKey(value: string | undefined): Uint8Array {
  if (!value || !/^[a-fA-F0-9]{64}$/.test(value))
    throw new Error("AUTH_MAIL_INTENT_KEY must be 32 bytes encoded as hex");
  return Uint8Array.from(value.match(/../g)!, (byte) => Number.parseInt(byte, 16));
}
