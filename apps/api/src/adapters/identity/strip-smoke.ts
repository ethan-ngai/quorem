import { strict as assert } from "node:assert";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { jwtVerifier } from "./jwt.ts";
import { authenticate, IdentityError } from "../../modules/identity/model.ts";
import { httpSessionAuthority } from "./session.ts";

const pair = await generateKeyPair("EdDSA", { extractable: true });
const jwk = { ...(await exportJWK(pair.publicKey)), kid: "fixture" };
const now = Math.floor(Date.now() / 1000);
const token = await new SignJWT({ sessionId: "session", emailVerified: true })
  .setProtectedHeader({ alg: "EdDSA", kid: "fixture" })
  .setIssuer("https://issuer.test")
  .setAudience("api")
  .setSubject("subject")
  .setIssuedAt(now)
  .setExpirationTime(now + 30)
  .sign(pair.privateKey);
const verifier = jwtVerifier({
  issuer: "https://issuer.test",
  audience: "api",
  jwksURL: "https://auth.test/jwks",
  fetch: async () => Response.json({ keys: [jwk] }),
});
const authority = httpSessionAuthority({
  baseURL: "https://auth.test",
  secret: "fixture",
  fetch: async () => new Response(null, { status: 204 }),
});
const bindings = {
  lookup: async () => ({
    current: true,
    principal: {
      kind: "managed" as const,
      credentialExpiresAt: 0,
      userId: "u",
      displayName: "u",
      admin: false,
      emailVerified: true,
      sessionId: "session",
      strongUntil: 0,
    },
  }),
  resolve: async () => {
    throw new Error("unexpected");
  },
};
assert.equal(
  (await authenticate(token, verifier, authority, bindings)).credentialExpiresAt,
  now + 30,
);
assert.equal(new IdentityError("unauthorized").kind, "unauthorized");
