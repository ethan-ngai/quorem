/** @file sha256.ts @description Browser-safe private fingerprints, including HTTP LAN origins. @module shared */
import { sha256 as digest } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** @returns SHA-256 hex without requiring a secure-context Web Crypto API. */
export async function sha256(text: string): Promise<string> {
  return bytesToHex(digest(new TextEncoder().encode(text)));
}
