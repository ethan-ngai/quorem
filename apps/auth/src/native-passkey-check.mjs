import assert from 'node:assert/strict';
import { Pool } from 'pg';
const origin='http://localhost:58738';
const pool=new Pool({connectionString:'postgres://postgres:fixture-only@127.0.0.1:55438/quorem_hono_auth_native_test'});
Object.assign(process.env,{APP_ENV:'local',AUTH_MODE:'password',AUTH_ORIGIN:origin,BETTER_AUTH_SECRET:'mock-secret-'.repeat(4),AUTH_DATABASE_URL:'postgres://postgres:fixture-only@127.0.0.1:55438/quorem_hono_auth_native_test',AUTH_INTERNAL_SECRET:'fixture-only'});
const node=await (await import('./node-auth.ts')).createNodeRuntime(process.env);
const userId=crypto.randomUUID(), email=`${userId}@example.test`, username=userId.replaceAll('-','').slice(0,16);
const bytes = (...parts)=>Buffer.concat(parts.map(x=>Buffer.from(x)));
const b64 = value => Buffer.from(value).toString('base64url');
const cbor = value => {
  const head=(major,n)=>n<24 ? Buffer.from([major<<5|n]) : n<256 ? Buffer.from([major<<5|24,n]) : Buffer.from([major<<5|25,n>>8,n&255]);
  if (Number.isInteger(value)) return value>=0?head(0,value):head(1,-1-value);
  if (typeof value==='string') { const data=Buffer.from(value); return bytes(head(3,data.length),data); }
  if (value instanceof Uint8Array) return bytes(head(2,value.length),value);
  if (value instanceof Map) return bytes(head(5,value.size),...[...value].flatMap(([key,item])=>[cbor(key),cbor(item)]));
  throw Error('Unsupported fixture CBOR');
};
const hash=async value=>Buffer.from(await crypto.subtle.digest('SHA-256',value));
const key=await crypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']);
const publicKey=Buffer.from(await crypto.subtle.exportKey('raw',key.publicKey));
const credential=crypto.getRandomValues(new Uint8Array(32));
const id=b64(credential);
const cose=cbor(new Map([[1,1],[3,-8],[-1,6],[-2,publicKey]]));
const rpHash=await hash(Buffer.from('localhost'));
const jar=new Map();
const save=response=>{for(const value of response.headers.getSetCookie()){const part=value.split(';')[0];const pos=part.indexOf('='); if(pos>=0) jar.set(part.slice(0,pos),part.slice(pos+1));}};
const cookie=()=>[...jar].map(([name,value])=>`${name}=${value}`).join('; ');
async function call(path,method='GET',body) {
  const response=await fetch(origin+path,{method,headers:{origin,cookie:cookie(),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  save(response);return response;
}
async function options(path) {const response=await call('/api/auth/passkey/'+path);assert.equal(response.status,200,await response.clone().text());return response.json();}
function clientData(type,challenge) {return Buffer.from(JSON.stringify({type,challenge,origin,crossOrigin:false}));}
async function assertion(challenge,counter,uv=true) {
  const data=clientData('webauthn.get',challenge);
  const n=Buffer.alloc(4); n.writeUInt32BE(counter);
  const authenticatorData=bytes(rpHash,Buffer.from([uv?5:1]),n);
  const signature=await crypto.subtle.sign('Ed25519',key.privateKey,bytes(authenticatorData,await hash(data)));
  return {id,rawId:id,type:'public-key',clientExtensionResults:{},response:{clientDataJSON:b64(data),authenticatorData:b64(authenticatorData),signature:b64(signature),userHandle:null}};
}
try {
  await pool.query('DELETE FROM quorem_auth.rate_limit');
  const signup=await call('/fixture/signup','POST',{email,username,name:'Passkey fixture',password:'fixture password'});
  assert.equal(signup.status,200,await signup.clone().text());
  const subject=(await signup.json()).user.id;
  await pool.query('UPDATE quorem_auth."user" SET "emailVerified"=true WHERE id=$1',[subject]);
  const login=await call('/api/auth/sign-in/email','POST',{email,password:'fixture password'});
  assert.equal(login.status,200,await login.clone().text());
  const registration=await options('generate-register-options');
  const client=clientData('webauthn.create',registration.challenge);
  const authData=bytes(rpHash,Buffer.from([0x45]),Buffer.alloc(4),Buffer.alloc(16),Buffer.from([0,credential.length]),credential,cose);
  const attestation=cbor(new Map([['fmt','none'],['authData',authData],['attStmt',new Map()]]));
  const result=await call('/api/auth/passkey/verify-registration','POST',{name:'Virtual authenticator',response:{id,rawId:id,type:'public-key',clientExtensionResults:{},response:{clientDataJSON:b64(client),attestationObject:b64(attestation),transports:['internal']}}});
  assert.equal(result.status,200,await result.clone().text());
  const passkey=await result.json();
  assert.equal(passkey.counter,0);
  const authOptions=await options('generate-authenticate-options');
  const firstAssertion=await assertion(authOptions.challenge,1,true);
  const verified=await call('/api/auth/passkey/verify-authentication','POST',{response:firstAssertion});
  assert.equal(verified.status,200,await verified.clone().text());
  const verifiedData=await verified.json();
  assert((await call('/api/auth/passkey/verify-authentication','POST',{response:firstAssertion})).status>=400);
  const authority=await (await fetch(origin+`/fixture/authority?session=${verifiedData.session.id}&subject=${subject}`)).json();
  assert.equal(authority.valid,true);assert(Number.isSafeInteger(authority.strongAt));
  const nodeSession=await node.auth.handler(new Request(origin+'/api/auth/get-session',{headers:{cookie:cookie(),origin}}));
  assert.equal((await nodeSession.json()).user.id,subject);
  const noUvOptions=await options('generate-authenticate-options');
  const noUv=await call('/api/auth/passkey/verify-authentication','POST',{response:await assertion(noUvOptions.challenge,2,false)});
  assert.equal(noUv.status,200,await noUv.clone().text());
  const noUvData=await noUv.json();
  const weak=await (await fetch(origin+`/fixture/authority?session=${noUvData.session.id}&subject=${subject}`)).json();
  assert.deepEqual(weak,{valid:true});
  const replayOptions=await options('generate-authenticate-options');
  const replay=await call('/api/auth/passkey/verify-authentication','POST',{response:await assertion(replayOptions.challenge,2,true)});
  assert(replay.status>=400);
  const tamperOptions=await options('generate-authenticate-options');
  const tampered=await assertion(tamperOptions.challenge,3,true);
  const signature=Buffer.from(tampered.response.signature,'base64url');signature[0]^=1;tampered.response.signature=b64(signature);
  assert((await call('/api/auth/passkey/verify-authentication','POST',{response:tampered})).status>=400);
  assert.equal(Number((await pool.query('SELECT counter FROM quorem_auth.passkey WHERE id=$1',[passkey.id])).rows[0].counter),2);
  const nodeOptionsResponse=await node.auth.handler(new Request(origin+'/api/auth/passkey/generate-authenticate-options',{headers:{cookie:cookie(),origin}}));
  assert.equal(nodeOptionsResponse.status,200);save(nodeOptionsResponse);
  const nodeOptions=await nodeOptionsResponse.json();
  const nodeAssertion=await node.auth.handler(new Request(origin+'/api/auth/passkey/verify-authentication',{method:'POST',headers:{cookie:cookie(),origin,'content-type':'application/json'},body:JSON.stringify({response:await assertion(nodeOptions.challenge,3,true)})}));
  assert.equal(nodeAssertion.status,200,await nodeAssertion.clone().text());save(nodeAssertion);
  const nodeAuth=await nodeAssertion.json();
  const workerSession=await call('/api/auth/get-session');
  assert.equal((await workerSession.json()).session.id,nodeAuth.session.id);
  const nodeAuthority=await node.authRepository.sessionAuthority(nodeAuth.session.id,subject);
  assert.equal(nodeAuthority.valid,true);assert(Number.isSafeInteger(nodeAuthority.strongAt));
  const maxOptions=await options('generate-authenticate-options');
  const maximum=await call('/api/auth/passkey/verify-authentication','POST',{response:await assertion(maxOptions.challenge,4294967295,true)});
  assert.equal(maximum.status,200,await maximum.clone().text());
  assert.equal((await pool.query('SELECT counter FROM quorem_auth.passkey WHERE id=$1',[passkey.id])).rows[0].counter,'4294967295');
  const maxReplay=await options('generate-authenticate-options');
  assert((await call('/api/auth/passkey/verify-authentication','POST',{response:await assertion(maxReplay.challenge,4294967295,true)})).status>=400);
  const invalidCounterOptions=await options('generate-authenticate-options');
  await pool.query('UPDATE quorem_auth.passkey SET counter=4294967296 WHERE id=$1',[passkey.id]);
  assert((await call('/api/auth/passkey/verify-authentication','POST',{response:await assertion(invalidCounterOptions.challenge,4,true)})).status>=400);
  await pool.query('UPDATE quorem_auth.passkey SET counter=4294967295 WHERE id=$1',[passkey.id]);
  const deleted=await call('/api/auth/passkey/delete-passkey','POST',{id:passkey.id});
  assert.equal(deleted.status,200,await deleted.clone().text());
  const revokedOptions=await options('generate-authenticate-options');
  assert((await call('/api/auth/passkey/verify-authentication','POST',{response:await assertion(revokedOptions.challenge,4,true)})).status>=400);
  assert.equal((await pool.query('SELECT 1 FROM quorem_auth.passkey WHERE id=$1',[passkey.id])).rowCount,0);
  console.log('PASS Worker/Node signed passkey ceremonies, strong/weak assurance, counter and revocation');
} finally {await pool.query('DELETE FROM quorem_auth."user" WHERE email=$1',[email]);await pool.end();await node.database.end();}
