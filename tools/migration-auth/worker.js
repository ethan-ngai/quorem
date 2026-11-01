import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { jwt, username } from 'better-auth/plugins';
import { passkey } from '@better-auth/passkey';
import { google, apple, github, cognito } from 'better-auth/social-providers';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export default { async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === '/crypto') {
    const { hash } = await request.json();
    const start = performance.now();
    const oldVerified = await verifyPassword({ hash, password:'fixture password' });
    const workerHash = await hashPassword('fixture password');
    return Response.json({oldVerified, workerHash, ms:performance.now()-start, providers:[google,apple,github,cognito].every(x=>typeof x==='function')});
  }
  const client = new pg.Client({ connectionString:'postgres://postgres:fixture-only@127.0.0.1:55432/quorem_hono_auth_runtime_test' });
  await client.connect();
  try {
    const auth = betterAuth({baseURL:url.origin, secret:'fixture-only-secret-at-least-32-characters-long', database:drizzleAdapter(drizzle(client,{schema}), {provider:'pg',schema}), emailAndPassword:{enabled:true,requireEmailVerification:true}, plugins:[username(),passkey({rpID:'localhost',rpName:'Fixture',origin:url.origin}),jwt({jwks:{keyPairConfig:{alg:'EdDSA',crv:'Ed25519'},rotationInterval:86400,gracePeriod:600},jwt:{issuer:url.origin,audience:'quorem-api',expirationTime:'5m'}})]});
    return await auth.handler(request);
  } finally { await client.end(); }
}};
