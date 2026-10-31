/** @file mail-intents.test.ts @description Disposable PostgreSQL mail-intent integration. @module auth */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'pg';
import { createNodePool, withNodeConnection, type Transaction } from '@quorem/database/core';
import { createMailRepository } from './mail-repository.ts';
import { createMailIntentService, MailRejected } from './mail-intent.ts';
import { mailCipher } from './mail-crypto.ts';
import { createRegistrationHandler } from './registration.ts';
import { accountMailer } from './account-mailer.ts';
import { migrateAuth } from './migrations.ts';

const url = process.env.QUOREM_MAIL_TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/quorem_hono_mail_test' || !['55440', '55445'].includes(new URL(url).port) || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) throw new Error('Use the disposable mail test database');
const pool = createNodePool({ connectionString: url, max: 3, connectionTimeoutMs: 1000, idleTimeoutMs: 1000, onIdleError: (error) => { throw error; } });
const run = <T>(callback: (tx: Transaction) => Promise<T>) => withNodeConnection(pool, { lifetimeMs: 5000 }, (scope) => scope.transaction({ statementTimeoutMs: 3000, lockTimeoutMs: 1000 }, callback));
const repository = createMailRepository(run);
const key = new Uint8Array(32).fill(9);
const origin = 'http://localhost:5180';
const messages: string[] = [];
const mail = createMailIntentService({ repository, key, deliver: async (_email, link) => { messages.push(link); } });
const handler = createRegistrationHandler({ repository, mail, origin });
const call = async (path: string, body?: object, cookie = '') => (await handler(new Request(`${origin}/api/auth/registration/${path}`, { method: body ? 'POST' : 'GET', headers: { origin, cookie }, body: body ? JSON.stringify(body) : undefined })))!;
before(async () => { await pool.query('DROP SCHEMA IF EXISTS quorem_auth CASCADE'); await migrateAuth(pool); });
after(async () => { await pool.end(); });

void test('registration commits encrypted intent, proves email, and creates credentials once', async () => {
  const email = 'registration@example.test';
  assert.equal((await call('start', { email })).status, 200);
  assert.equal(messages.length, 1);
  const token = new URL(messages[0]).searchParams.get('signupToken');
  assert.ok(token);
  const stored = (await pool.query('select ciphertext,nonce,state from quorem_auth.mail_intent order by created_at desc limit 1')).rows[0];
  assert.equal(stored.state, 'accepted');
  assert.equal(stored.nonce.length, 12);
  assert.equal(stored.ciphertext.includes(Buffer.from(token)), false);
  assert.equal(stored.ciphertext.includes(Buffer.from(email)), false);
  const verified = await call('verify', { token });
  assert.equal(verified.status, 200);
  const cookie = verified.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await call('status', undefined, cookie)).status, 200);
  assert.equal((await call('verify', { token })).status, 400);
  assert.equal((await call('complete', { email, username: 'mailproof', password: 'Abc1234!', name: 'Proof' }, cookie)).status, 200);
  assert.equal((await call('complete', { email, username: 'mailproof', password: 'Abc1234!', name: 'Proof' }, cookie)).status, 401);
  const user = (await pool.query('select "emailVerified" from quorem_auth."user" where email=$1', [email])).rows[0];
  assert.equal(user.emailVerified, true);
});

void test('uncertain acceptance retains proof and budgets; explicit resend supersedes it', async () => {
  const links: string[] = [];
  const uncertain = createMailIntentService({ repository, key, deliver: async (_email, link) => { links.push(link); throw new Error('connection lost'); } });
  const email = 'uncertain@example.test';
  assert.equal(await uncertain.create('registration', { email, url: `${origin}/login?token=first` }, 'first-hash'), 'uncertain');
  assert.equal((await pool.query('select token_hash from quorem_auth.registration_email where email=$1', [email])).rows[0].token_hash, 'first-hash');
  await assert.rejects(uncertain.create('registration', { email, url: `${origin}/login?token=second` }, 'second-hash'), /rate limited/i);
  await pool.query("delete from quorem_auth.rate_limit where bucket=$1", [await (await import('./mail-crypto.ts')).digest(JSON.stringify(['email:registration:cooldown', email]))]);
  assert.equal(await mail.create('registration', { email, url: `${origin}/login?token=second` }, 'second-hash'), 'accepted');
  assert.equal((await pool.query('select token_hash from quorem_auth.registration_email where email=$1', [email])).rows[0].token_hash, 'second-hash');
  assert.equal(await repository.verify('first-hash', 'old-grant'), false);
  assert.equal(links.length, 1);
});

void test('definite rejection refunds budgets for explicit retry without automatic retry', async () => {
  let sends = 0;
  const rejected = createMailIntentService({ repository, key, deliver: async () => { sends++; if (sends === 1) throw new MailRejected('rejected'); } });
  const email = 'rejected@example.test';
  assert.equal(await rejected.create('account', { email, url: `${origin}/reset` }), 'rejected');
  assert.equal(sends, 1);
  assert.equal(await rejected.create('account', { email, url: `${origin}/reset` }), 'accepted');
  assert.equal(sends, 2);
  assert.equal((await pool.query("select state from quorem_auth.mail_intent where state='rejected'")).rows.length, 1);
});

void test('claim expiry, supersession and stale acknowledgments never deliver', async () => {
  const cipher = mailCipher(key);
  const email = 'claim@example.test';
  const id = crypto.randomUUID();
  await repository.create({ id, purpose: 'account', email, encrypt: (generation) => cipher.encrypt(id, 'account', generation, { email, url: `${origin}/reset` }) });
  const claim = await repository.claim(id); assert.ok(claim);
  await pool.query("update quorem_auth.mail_intent set claim_until=now()-interval '1 second' where id=$1", [id]);
  assert.equal(await repository.acknowledge(claim, 'accepted'), false);
  assert.equal(await repository.claim(id), undefined);
  assert.equal((await pool.query('select state from quorem_auth.mail_intent where id=$1', [id])).rows[0].state, 'uncertain');
  await pool.query("delete from quorem_auth.rate_limit where bucket=$1", [await (await import('./mail-crypto.ts')).digest(JSON.stringify(['email:account:cooldown', email]))]);
  const next = crypto.randomUUID();
  await repository.create({ id: next, purpose: 'account', email, encrypt: (generation) => cipher.encrypt(next, 'account', generation, { email, url: `${origin}/reset2` }) });
  assert.equal(await repository.acknowledge(claim, 'accepted'), false);
  await pool.query("update quorem_auth.mail_intent set expires_at=now()-interval '1 second' where id=$1", [next]);
  assert.equal(await repository.claim(next), undefined);
});

void test('account gateway stores after token creation and fails closed on insert failure', async () => {
  let deliveries = 0;
  const failing = createMailIntentService({ repository: { ...repository, create: async () => { throw new Error('database unavailable'); } }, key, deliver: async () => { deliveries++; } });
  await assert.rejects(accountMailer(failing)('account@example.test', `${origin}/token`, 'subject', 'instruction'));
  assert.equal(deliveries, 0);
  assert.throws(() => createMailIntentService({ repository, key: new Uint8Array(31), deliver: async () => {} }), /32 bytes/);
});

void test('lost acknowledgment never sends twice', async () => {
  let sends = 0;
  const failingAck = createMailIntentService({ repository: { ...repository, acknowledge: async (claim, state) => { await repository.acknowledge(claim, state); throw new Error('acknowledgment lost'); } }, key, deliver: async () => { sends++; } });
  assert.equal(await failingAck.create('account', { email: 'lost-ack@example.test', url: `${origin}/reset` }), 'uncertain');
  const id = (await pool.query("select id from quorem_auth.mail_intent where state='accepted' order by created_at desc limit 1")).rows[0].id;
  assert.equal(await failingAck.dispatch(id), 'uncertain');
  assert.equal(sends, 1);
});

void test('a verified account cannot be replaced using registration proof', async () => {
  const email = 'verified@example.test';
  const id = crypto.randomUUID();
  await pool.query('insert into quorem_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") values($1,$2,$3,true,now(),now())', [id, 'Original', email]);
  const beforeCount = messages.length;
  assert.equal((await call('start', { email })).status, 200);
  const token = new URL(messages[beforeCount]).searchParams.get('signupToken');
  const verified = await call('verify', { token });
  const cookie = verified.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await call('complete', { email, username: 'replaceuser', password: 'Abc1234!', name: 'Replacement' }, cookie)).status, 409);
  assert.equal((await pool.query('select name from quorem_auth."user" where id=$1', [id])).rows[0].name, 'Original');
});

void test('encryption failure rolls back challenge and all budgets', async () => {
  const email = 'atomic@example.test';
  await assert.rejects(repository.create({ id: crypto.randomUUID(), purpose: 'registration', email, tokenHash: 'not-saved', encrypt: async () => { throw new Error('encryption failed'); } }), /encryption failed/);
  assert.equal((await pool.query('select count(*)::int as n from quorem_auth.registration_email where email=$1', [email])).rows[0].n, 0);
  assert.equal(await mail.create('registration', { email, url: `${origin}/login` }, 'saved'), 'accepted');
});

void test('resend cancels an in-flight claim and fences its acknowledgment', async () => {
  const email = 'supersede@example.test';
  const cipher = mailCipher(key);
  const old = crypto.randomUUID();
  await repository.create({ id: old, purpose: 'account', email, encrypt: (generation) => cipher.encrypt(old, 'account', generation, { email, url: `${origin}/old` }) });
  const claim = await repository.claim(old); assert.ok(claim);
  await pool.query('delete from quorem_auth.rate_limit where bucket=$1', [await (await import('./mail-crypto.ts')).digest(JSON.stringify(['email:account:cooldown', email]))]);
  const next = crypto.randomUUID();
  await repository.create({ id: next, purpose: 'account', email, encrypt: (generation) => cipher.encrypt(next, 'account', generation, { email, url: `${origin}/new` }) });
  assert.equal(await repository.acknowledge(claim, 'accepted'), false);
  assert.equal((await pool.query('select state from quorem_auth.mail_intent where id=$1', [old])).rows[0].state, 'cancelled');
  assert.equal(await repository.claim(old), undefined);
});

void test('verified proof replaces abandoned credentials and revokes sessions', async () => {
  const email = 'abandoned@example.test';
  const id = crypto.randomUUID();
  await pool.query('insert into quorem_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") values($1,$2,$3,false,now(),now())', [id, 'Unverified', email]);
  await pool.query('insert into quorem_auth.session(id,"expiresAt",token,"createdAt","updatedAt","userId") values($1,now()+interval \'1 hour\',$2,now(),now(),$3)', [crypto.randomUUID(), crypto.randomUUID(), id]);
  await pool.query('insert into quorem_auth.account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") values($1,$2,\'credential\',$2,\'old\',now(),now())', [crypto.randomUUID(), id]);
  const index = messages.length;
  assert.equal((await call('start', { email })).status, 200);
  const token = new URL(messages[index]).searchParams.get('signupToken');
  const proof = await call('verify', { token });
  const cookie = proof.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await call('complete', { email, username: 'recovereduser', password: 'Abc1234!', name: 'Owner' }, cookie)).status, 200);
  assert.equal((await pool.query('select count(*)::int as n from quorem_auth.session where "userId"=$1', [id])).rows[0].n, 0);
  const accounts = await pool.query('select password from quorem_auth.account where "userId"=$1', [id]);
  assert.equal(accounts.rowCount, 1);
  assert.notEqual(accounts.rows[0].password, 'old');
  assert.equal((await pool.query('select "emailVerified" from quorem_auth."user" where id=$1', [id])).rows[0].emailVerified, true);
});

void test('delivery runs after transaction release and ciphertext binds metadata', async () => {
  const cipher = mailCipher(key);
  const sealed = await cipher.encrypt('id-one', 'account', 1, { secret: 'value' });
  await assert.rejects(cipher.decrypt('id-two', 'account', 1, sealed.nonce, sealed.ciphertext));
  await assert.rejects(cipher.decrypt('id-one', 'account', 2, sealed.nonce, sealed.ciphertext));
  await assert.rejects(cipher.decrypt('id-one', 'registration', 1, sealed.nonce, sealed.ciphertext));
  let open = -1;
  const checked = createMailIntentService({ repository, key, deliver: async () => { open = (await pool.query("select count(*)::int as n from pg_stat_activity where datname=current_database() and state='idle in transaction'")).rows[0].n; } });
  assert.equal(await checked.create('account', { email: 'no-locks@example.test', url: `${origin}/reset` }), 'accepted');
  assert.equal(open, 0);
});

void test('account budgets remain shared across subjects and recipients', async () => {
  const sender = accountMailer(mail);
  const email = 'shared-budget@example.test';
  await sender(email, `${origin}/one`, 'Reset password', 'Reset');
  await assert.rejects(sender(email, `${origin}/two`, 'Change address', 'Confirm'), /Try again/);
  const { digest } = await import('./mail-crypto.ts');
  const global = await digest(JSON.stringify(['email:account:global', 'global']));
  await pool.query("update quorem_auth.rate_limit set used=100,expires_at=now()+interval '1 hour' where bucket=$1", [global]);
  await assert.rejects(sender('different-recipient@example.test', `${origin}/three`, 'Reset password', 'Reset'), /Try again/);
  await pool.query('update quorem_auth.rate_limit set used=0 where bucket=$1', [global]);
});

void test('rejected resend restores the prior registration challenge', async () => {
  const email = 'restore@example.test';
  assert.equal(await mail.create('registration', { email, url: `${origin}/old` }, 'restore-old'), 'accepted');
  const { digest } = await import('./mail-crypto.ts');
  const bucket = await digest(JSON.stringify(['email:registration:cooldown', email]));
  await pool.query("update quorem_auth.rate_limit set expires_at=now()-interval '1 second' where bucket=$1", [bucket]);
  const reject = createMailIntentService({ repository, key, deliver: async () => { throw new MailRejected('reject'); } });
  assert.equal(await reject.create('registration', { email, url: `${origin}/new` }, 'restore-new'), 'rejected');
  assert.equal((await pool.query('select token_hash from quorem_auth.registration_email where email=$1', [email])).rows[0].token_hash, 'restore-old');
  assert.equal(await repository.verify('restore-old', 'restored-grant'), true);
});

void test('old rejected claim cannot refund a rolled-over global bucket', async () => {
  const { digest } = await import('./mail-crypto.ts');
  const cipher = mailCipher(key);
  const email = 'rollover-a@example.test';
  const id = crypto.randomUUID();
  await repository.create({ id, purpose: 'account', email, encrypt: (generation) => cipher.encrypt(id, 'account', generation, { email, url: `${origin}/old` }) });
  const claim = await repository.claim(id); assert.ok(claim);
  const bucket = await digest(JSON.stringify(['email:account:global', 'global']));
  await pool.query("update quorem_auth.rate_limit set used=100,expires_at=now()-interval '1 second' where bucket=$1", [bucket]);
  assert.equal(await mail.create('account', { email: 'rollover-b@example.test', url: `${origin}/new` }), 'accepted');
  assert.equal(await repository.acknowledge(claim, 'rejected', email), true);
  assert.equal(await repository.acknowledge(claim, 'rejected', email), false);
  assert.equal((await pool.query('select used from quorem_auth.rate_limit where bucket=$1', [bucket])).rows[0].used, 1);
});

void test('concurrent senders and superseded rejection cannot refund newer reservations', async () => {
  const { digest } = await import('./mail-crypto.ts');
  const cipher = mailCipher(key);
  const email = 'race@example.test';
  const create = (id: string) => repository.create({ id, purpose: 'account', email, encrypt: (generation) => cipher.encrypt(id, 'account', generation, { email, url: `${origin}/link` }) });
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  const attempts = await Promise.allSettled(ids.map(create));
  assert.equal(attempts.filter((value) => value.status === 'fulfilled').length, 1);
  const old = ids[attempts.findIndex((value) => value.status === 'fulfilled')];
  const claim = await repository.claim(old); assert.ok(claim);
  const cooldown = await digest(JSON.stringify(['email:account:cooldown', email]));
  const hour = await digest(JSON.stringify(['email:account:hour', email]));
  await pool.query("update quorem_auth.rate_limit set expires_at=now()-interval '1 second' where bucket=$1", [cooldown]);
  const next = crypto.randomUUID(); await create(next);
  const used = (await pool.query('select used from quorem_auth.rate_limit where bucket=$1', [hour])).rows[0].used;
  assert.equal(await repository.acknowledge(claim, 'rejected', email), false);
  assert.equal((await pool.query('select used from quorem_auth.rate_limit where bucket=$1', [hour])).rows[0].used, used);
});

void test('restored grant survives rejection without restoring stale sender authority', async () => {
  const { digest } = await import('./mail-crypto.ts');
  const cipher = mailCipher(key);
  const email = 'old-grant@example.test';
  const old = crypto.randomUUID();
  await repository.create({ id: old, purpose: 'registration', email, tokenHash: 'old-grant-token', encrypt: (generation) => cipher.encrypt(old, 'registration', generation, { email, url: `${origin}/old` }) });
  const stale = await repository.claim(old); assert.ok(stale);
  assert.equal(await repository.verify('old-grant-token', 'old-grant-hash'), true);
  const cooldown = await digest(JSON.stringify(['email:registration:cooldown', email]));
  await pool.query("update quorem_auth.rate_limit set expires_at=now()-interval '1 second' where bucket=$1", [cooldown]);
  const rejected = createMailIntentService({ repository, key, deliver: async () => { throw new MailRejected('rejected'); } });
  assert.equal(await rejected.create('registration', { email, url: `${origin}/failed` }, 'failed-generation'), 'rejected');
  assert.equal((await repository.status('old-grant-hash'))?.email, email);
  assert.equal(await repository.acknowledge(stale, 'accepted', email), false);
  assert.equal(await mail.create('registration', { email, url: `${origin}/retry` }, 'retry-generation'), 'accepted');
  assert.equal(await repository.status('old-grant-hash'), undefined);
  const rows = await pool.query('select generation,state from quorem_auth.mail_intent where recipient_key=$1 order by generation', [stale.recipient_key]);
  assert.deepEqual(rows.rows.map((row) => row.generation), [1, 2, 3]);
  assert.equal(await repository.acknowledge(stale, 'rejected', email), false);
});

void test('uncertain registration returns unavailable while preserving proof and budget', async () => {
  let link = '';
  const uncertainMail = createMailIntentService({ repository, key, deliver: async (_email, url) => { link = url; throw new Error('lost provider response'); } });
  const localHandler = createRegistrationHandler({ repository, mail: uncertainMail, origin });
  const email = 'uncertain-http@example.test';
  const request = () => new Request(`${origin}/api/auth/registration/start`, { method: 'POST', headers: { origin }, body: JSON.stringify({ email }) });
  const response = (await localHandler(request()))!;
  assert.equal(response.status, 503);
  const token = new URL(link).searchParams.get('signupToken'); assert.ok(token);
  const { digest } = await import('./mail-crypto.ts');
  assert.equal((await pool.query('select token_hash from quorem_auth.registration_email where email=$1', [email])).rows[0].token_hash, await digest(token));
  assert.equal((await pool.query("select state from quorem_auth.mail_intent where state='uncertain' order by created_at desc limit 1")).rows[0].state, 'uncertain');
  assert.equal((await localHandler(request()))!.status, 200);
});

void test('concurrent dispatch claims deliver at most once', async () => {
  const cipher = mailCipher(key); const id = crypto.randomUUID(); const email = 'duplicate-claim@example.test';
  await repository.create({ id, purpose: 'account', email, encrypt: (generation) => cipher.encrypt(id, 'account', generation, { email, url: `${origin}/link` }) });
  let sends = 0;
  const service = createMailIntentService({ repository, key, deliver: async () => { sends++; await delay(50); } });
  const results = await Promise.all([service.dispatch(id), service.dispatch(id)]);
  assert.equal(sends, 1);
  assert.deepEqual([...results].sort(), ['accepted', 'uncertain']);
});

void test('corrupted ciphertext never reaches the provider or refunds', async () => {
  const cipher = mailCipher(key); const id = crypto.randomUUID(); const email = 'corrupt@example.test';
  await repository.create({ id, purpose: 'account', email, encrypt: (generation) => cipher.encrypt(id, 'account', generation, { email, url: `${origin}/link` }) });
  await pool.query('update quorem_auth.mail_intent set ciphertext=set_byte(ciphertext,0,get_byte(ciphertext,0) # 1) where id=$1', [id]);
  let sends = 0;
  const service = createMailIntentService({ repository, key, deliver: async () => { sends++; } });
  assert.equal(await service.dispatch(id), 'uncertain');
  assert.equal(sends, 0);
  assert.equal((await pool.query('select state from quorem_auth.mail_intent where id=$1', [id])).rows[0].state, 'uncertain');
  await assert.rejects(service.create('account', { email, url: `${origin}/link` }), /rate limited/);
});

void test('acknowledgment cannot pass an expired lease after waiting for its lock', async () => {
  const cipher = mailCipher(key); const id = crypto.randomUUID(); const email = 'lease-lock@example.test';
  await repository.create({ id, purpose: 'account', email, encrypt: (generation) => cipher.encrypt(id, 'account', generation, { email, url: `${origin}/link` }) });
  const claim = await repository.claim(id); assert.ok(claim);
  await pool.query("update quorem_auth.mail_intent set claim_until=clock_timestamp()+interval '200 milliseconds' where id=$1", [id]);
  const blocker = new Client({ connectionString: url }); await blocker.connect();
  try {
    await blocker.query('BEGIN');
    await blocker.query('select pg_advisory_xact_lock(hashtextextended($1,62))', [`${claim.purpose}:${claim.recipient_key}`]);
    const pending = repository.acknowledge(claim, 'rejected', email);
    await delay(350);
    await blocker.query('COMMIT');
    assert.equal(await pending, false);
    assert.equal(await repository.claim(id), undefined);
    assert.equal((await pool.query('select state from quorem_auth.mail_intent where id=$1', [id])).rows[0].state, 'uncertain');
  } finally { await blocker.end(); }
});

void test('claim cannot start after intent expiry while blocked on its row', async () => {
  const cipher = mailCipher(key); const id = crypto.randomUUID(); const email = 'expiry-lock@example.test';
  await repository.create({ id, purpose: 'account', email, encrypt: (generation) => cipher.encrypt(id, 'account', generation, { email, url: `${origin}/link` }) });
  await pool.query("update quorem_auth.mail_intent set expires_at=clock_timestamp()+interval '200 milliseconds' where id=$1", [id]);
  const blocker = new Client({ connectionString: url }); await blocker.connect();
  try {
    await blocker.query('BEGIN'); await blocker.query('select id from quorem_auth.mail_intent where id=$1 for update', [id]);
    const pending = repository.claim(id);
    await delay(350); await blocker.query('COMMIT');
    assert.equal(await pending, undefined);
  } finally { await blocker.end(); }
});

void test('proof and grant expiry are checked after waiting for row locks', async () => {
  const email = 'proof-lock@example.test';
  await mail.create('registration', { email, url: `${origin}/link` }, 'proof-lock-token');
  await pool.query("update quorem_auth.registration_email set expires_at=clock_timestamp()+interval '200 milliseconds' where email=$1", [email]);
  const blocker = new Client({ connectionString: url }); await blocker.connect();
  try {
    await blocker.query('BEGIN'); await blocker.query('select email from quorem_auth.registration_email where email=$1 for update', [email]);
    const pending = repository.verify('proof-lock-token', 'proof-lock-grant');
    await delay(350); await blocker.query('COMMIT');
    assert.equal(await pending, false);
    await pool.query("update quorem_auth.registration_email set grant_hash='proof-lock-grant', expires_at=clock_timestamp()+interval '200 milliseconds' where email=$1", [email]);
    await blocker.query('BEGIN'); await blocker.query('select email from quorem_auth.registration_email where email=$1 for update', [email]);
    const completion = repository.complete({ grantHash: 'proof-lock-grant', email, username: 'expiredproof', name: '', passwordHash: 'unused' });
    await delay(350); await blocker.query('COMMIT');
    assert.equal(await completion, 'expired');
    assert.equal((await pool.query('select count(*)::int as n from quorem_auth."user" where email=$1', [email])).rows[0].n, 0);
  } finally { await blocker.end(); }
});
