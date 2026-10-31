import { expect, it } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { jwtVerifier } from './jwt.ts';

it('verifies signed Ed25519 fixtures in workerd', async () => {
  const keys=await generateKeyPair('EdDSA',{extractable:true});
  const jwk={...await exportJWK(keys.publicKey),kid:'fixture'};
  const now=Math.floor(Date.now()/1000);
  const token=await new SignJWT({sessionId:'session',emailVerified:true}).setProtectedHeader({alg:'EdDSA',kid:'fixture'}).setIssuer('https://issuer.test').setAudience('quorem-api').setSubject('subject').setIssuedAt(now).setExpirationTime(now+60).sign(keys.privateKey);
  const verifier=jwtVerifier({issuer:'https://issuer.test',audience:'quorem-api',jwksURL:'https://auth.test/jwks',fetch:async()=>Response.json({keys:[jwk]})});
  expect((await verifier.verify(token)).subject).toBe('subject');
});
