/** @file peer.ts @description Trusted client address normalization for auth rate limits. @module auth */
import { isIP } from "node:net";
export const peerHeaders = [
  "x-quorem-peer-ip",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "x-real-ip",
  "x-client-ip",
  "cf-connecting-ip",
  "cf-pseudo-ipv4",
  "true-client-ip",
  "fly-client-ip",
  "fastly-client-ip",
  "x-vercel-forwarded-for",
] as const;
/** Invalid or unavailable transport peers share the conservative missing-peer bucket. */
export function validPeer(value: string | null | undefined): string | undefined {
  return typeof value === "string" && isIP(value) ? value : undefined;
}
export function cloudflarePeer(headers: Headers, trusted: unknown): string | undefined {
  if (trusted !== undefined && trusted !== "true" && trusted !== "false")
    throw new Error("Invalid trusted ingress configuration");
  return trusted === "true" ? validPeer(headers.get("cf-connecting-ip")) : undefined;
}
/** Strip all caller-provided forwarding claims before attaching the transport peer. */
export function authPeerRequest(request: Request, peer: string | undefined): Request {
  const headers = new Headers(request.headers);
  for (const name of peerHeaders) headers.delete(name);
  const address = validPeer(peer);
  if (address) headers.set("x-quorem-peer-ip", address);
  return new Request(request, { headers });
}
