import { describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { jwtVerifier } from './jwt.ts';
import { httpSessionAuthority } from './session.ts';
import { authenticate, IdentityError } from '../../modules/identity/model.ts';
import { nodeLocalIdentity } from './node-local.ts';
import { bearer } from '../../modules/identity/credentials.ts';

describe('managed identity', () => {
  it('enforces signed claims, rotation, session revocation and authority outage', async () => {
    const first=await generateKeyPair('EdDSA',{extractable:true});
    const second=await generateKeyPair('EdDSA',{extractable:true});
    const key=async (publicKey:CryptoKey,kid:string)=>({...await exportJWK(publicKey),kid,alg:'EdDSA'});
    let keys=[await key(first.publicKey,'first')]; let fetches=0;
    const verifier=jwtVerifier({issuer:'https://auth.test',audience:'quorem-api',jwksURL:'https://auth.test/jwks',fetch:async()=>{fetches++;return Response.json({keys});}});
    const now=Math.floor(Date.now()/1000);
    const token=async (changes:Record<string,unknown>={}, privateKey=first.privateKey, kid='first') => new SignJWT({sessionId:'session',emailVerified:true,name:'Fixture',color:5,colorRevision:10,...changes}).setProtectedHeader({alg:'EdDSA',kid}).setIssuer('https://auth.test').setAudience('quorem-api').setSubject('subject').setIssuedAt(now).setExpirationTime(now+300).sign(privateKey);
    const valid=await token();
    expect(await verifier.verify(valid)).toMatchObject({subject:'subject',issuedAt:now,expiresAt:now+300});
    expect(fetches).toBe(1);
    for (const changes of [{emailVerified:false},{sessionId:''},{colorRevision:Number.MAX_SAFE_INTEGER+1}]) await expect(verifier.verify(await token(changes))).rejects.toMatchObject({kind:'unauthorized'});
    const stale=await new SignJWT({sessionId:'s',emailVerified:true}).setProtectedHeader({alg:'EdDSA',kid:'first'}).setIssuer('https://auth.test').setAudience('quorem-api').setSubject('s').setIssuedAt(now-301).setExpirationTime(now+1).sign(first.privateKey);
    await expect(verifier.verify(stale)).rejects.toMatchObject({kind:'unauthorized'});
    for (const [issuer,audience,issued,expiry] of [['wrong','quorem-api',now,now+20],['https://auth.test','wrong',now,now+20],['https://auth.test','quorem-api',now+31,now+60],['https://auth.test','quorem-api',now-50,now-1]] as const) {
      const bad=await new SignJWT({sessionId:'s',emailVerified:true}).setProtectedHeader({alg:'EdDSA',kid:'first'}).setIssuer(issuer).setAudience(audience).setSubject('s').setIssuedAt(issued).setExpirationTime(expiry).sign(first.privateKey);
      await expect(verifier.verify(bad)).rejects.toMatchObject({kind:'unauthorized'});
    }
    const forged=await token({},second.privateKey,'first');
    await expect(verifier.verify(forged)).rejects.toMatchObject({kind:'unauthorized'});
    await expect(verifier.verify('x'.repeat(16385))).rejects.toMatchObject({kind:'unauthorized'});
    const bindings={lookup:async()=>({current:true,principal:{kind:'managed' as const,credentialExpiresAt:now+300,userId:'u',displayName:'User',admin:false,emailVerified:true,sessionId:'session',strongUntil:0}}),resolve:async()=>{throw Error('unexpected');}};
    let status=204;
    const authority=httpSessionAuthority({baseURL:'https://auth.test',secret:'fixture',fetch:async()=>new Response(null,{status,headers:{'X-Auth-Strong-At':String(now-1)}})});
    const principal=await authenticate(valid,verifier,authority,bindings);
    expect(principal).toMatchObject({kind:'managed',credentialExpiresAt:now+300,strongUntil:now-1+600});
    vi.useFakeTimers();
    try {
      const slowAuthority={check:async()=>{vi.setSystemTime(new Date((now+300)*1000));return {};}};
      await expect(authenticate(valid,verifier,slowAuthority,bindings)).rejects.toMatchObject({kind:'unauthorized'});
    } finally { vi.useRealTimers(); }
    status=401; await expect(authenticate(valid,verifier,authority,bindings)).rejects.toMatchObject({kind:'unauthorized'});
    status=503; await expect(authenticate(valid,verifier,authority,bindings)).rejects.toMatchObject({kind:'unavailable'});
    keys=[await key(second.publicKey,'second')];
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date((now+2)*1000));
      expect((await verifier.verify(await token({},second.privateKey,'second'))).subject).toBe('subject');
      await expect(verifier.verify(valid)).rejects.toMatchObject({kind:'unauthorized'});
      expect(fetches).toBe(2);
    } finally { vi.useRealTimers(); }
  });
  it('rejects malformed authorization before any fallback and duplicate websocket credentials', () => {
    for(const value of ['', 'Bearer ', 'Basic x', 'Bearer a,b']) expect(()=>bearer(new Headers({authorization:value}))).toThrow(IdentityError);
    expect(()=>bearer(new Headers({'sec-websocket-protocol':'quorem, bearer.one, bearer.two'}))).toThrow(IdentityError);
    expect(bearer(new Headers({'sec-websocket-protocol':'quorem, bearer.one'}))).toBe('one');
    expect(bearer(new Headers({authorization:'Bearer a','sec-websocket-protocol':'bearer.b'}))).toBe('a');
  });
  it('restricts development identity to an explicit Node loopback adapter', async () => {
    const lookup=async (userId:string)=>({kind:'local' as const,userId,displayName:userId,admin:false,emailVerified:true,sessionId:'development',strongUntil:0});
    const local=await nodeLocalIdentity(new Headers(),'127.0.0.1',lookup);
    expect(local).toMatchObject({kind:'local',userId:'alice'});
    expect(local.credentialExpiresAt).toBeUndefined();
    await expect(nodeLocalIdentity(new Headers({'x-dev-user':'alice'}),'192.0.2.1',lookup)).rejects.toMatchObject({kind:'unauthorized'});
    await expect(nodeLocalIdentity(new Headers({authorization:'Bearer broken'}),'127.0.0.1',lookup)).rejects.toMatchObject({kind:'unauthorized'});
  });
  it('requires secure service origins except explicit loopback fixtures', () => {
    for (const baseURL of ['http://auth.example', 'http://localhost.example', 'https://user:password@auth.example', 'https://auth.example/path', 'https://auth.example/?secret=value', 'https://auth.example/#fragment', 'https://auth.example/?', 'https://auth.example/#', 'not a url']) {
      expect(() => httpSessionAuthority({baseURL,secret:'fixture'})).toThrow('Invalid identity service URL');
    }
    for (const baseURL of ['http://localhost:8082', 'http://127.0.0.1:8082', 'http://[::1]:8082', 'https://auth.example']) {
      expect(() => httpSessionAuthority({baseURL,secret:'fixture'})).not.toThrow();
    }
    for (const jwksURL of ['http://auth.example/jwks','https://name:password@auth.example/jwks','https://auth.example/jwks?secret=value','https://auth.example/jwks#fragment']) {
      expect(() => jwtVerifier({issuer:'https://auth.example',audience:'a',jwksURL})).toThrow('Invalid identity service URL');
    }
    expect(() => jwtVerifier({issuer:'http://localhost:8082',audience:'a',jwksURL:'http://127.0.0.1:8082/jwks'})).not.toThrow();
    expect(() => jwtVerifier({issuer:'https://auth.example/path',audience:'a',jwksURL:'https://auth.example/jwks'})).toThrow('Invalid identity service URL');
  });
  it('cancels rejected JWKS bodies and distinguishes unavailable from revoked', async () => {
    const pair=await generateKeyPair('EdDSA',{extractable:true}); const now=Math.floor(Date.now()/1000);
    const token=await new SignJWT({sessionId:'s',emailVerified:true}).setProtectedHeader({alg:'EdDSA',kid:'x'}).setIssuer('https://issuer.test').setAudience('a').setSubject('s').setIssuedAt(now).setExpirationTime(now+5).sign(pair.privateKey);
    for (const [status,length] of [[302,10],[503,10],[200,65537]] as const) {
      let cancelled=false;
      const stream=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}});
      const response=new Response(stream,{status,headers:{'content-length':String(length),...(status===302?{location:'https://other.test'}:{})}});
      let redirect:RequestRedirect|undefined;
      const verifier=jwtVerifier({issuer:'https://issuer.test',audience:'a',jwksURL:'https://auth.test/jwks',fetch:async (_url,init)=>{redirect=init?.redirect;return response;}});
      await expect(verifier.verify(token)).rejects.toMatchObject({kind:'unavailable'});
      expect(redirect).toBe('manual'); expect(cancelled).toBe(true);
    }
    let overflowCancelled=false;
    const overflow=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(65537));},cancel(){overflowCancelled=true;}});
    const oversized=jwtVerifier({issuer:'https://issuer.test',audience:'a',jwksURL:'https://auth.test/jwks',fetch:async()=>new Response(overflow)});
    await expect(oversized.verify(token)).rejects.toMatchObject({kind:'unavailable'});
    expect(overflowCancelled).toBe(true);
    const revoked=httpSessionAuthority({baseURL:'https://auth.test',secret:'fixture',fetch:async()=>new Response('revoked',{status:401})});
    await expect(revoked.check('s','u')).rejects.toMatchObject({kind:'unauthorized'});
    const redirected=httpSessionAuthority({baseURL:'https://auth.test',secret:'fixture',fetch:async (_url,init)=>{expect(init?.redirect).toBe('manual');return new Response(null,{status:302});}});
    await expect(redirected.check('s','u')).rejects.toMatchObject({kind:'unavailable'});
  });
  it('bounds and fails closed on upstream JWKS failures', async () => {
    const pair=await generateKeyPair('EdDSA',{extractable:true}); const now=Math.floor(Date.now()/1000);
    const token=await new SignJWT({sessionId:'s',emailVerified:true}).setProtectedHeader({alg:'EdDSA',kid:'x'}).setIssuer('https://issuer.test').setAudience('a').setSubject('s').setIssuedAt(now).setExpirationTime(now+5).sign(pair.privateKey);
    for (const response of [new Response(null,{status:302,headers:{location:'https://evil.test'}}),Response.json({keys:Array(21).fill({})}),new Response('x'.repeat(65537))]) {
      const verifier=jwtVerifier({issuer:'https://issuer.test',audience:'a',jwksURL:'https://auth.test/jwks',fetch:async()=>response});
      await expect(verifier.verify(token)).rejects.toMatchObject({kind:'unavailable'});
    }
  });
});
