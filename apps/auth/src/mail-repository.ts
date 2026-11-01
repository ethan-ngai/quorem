/** @file mail-repository.ts @description Auth mail and registration transactions. @module auth */
import { sql } from 'drizzle-orm';
import { classifyDatabaseError, type Transaction } from '@quorem/database/core';
import { digest } from './mail-crypto.ts';

type Run = <T>(callback: (tx: Transaction) => Promise<T>) => Promise<T>;
type Purpose = 'registration' | 'account';
type Envelope = { ciphertext: Buffer; nonce: Buffer };
type Draft = { id: string; purpose: Purpose; email: string; lane?: string; tokenHash?: string; encrypt: (generation: number) => Promise<Envelope> };
type Claim = { id: string; purpose: Purpose; recipient_key: string; generation: number; nonce: Buffer; ciphertext: Buffer; claim: string };
export class MailRateLimited extends Error {
  readonly retryAfter: number;
  constructor(retryAfter: number) { super('Mail rate limited'); this.retryAfter = retryAfter; }
}

type Reservation = { bucket: string; expiresAt: string };
type Previous = { token_hash: string | null; grant_hash: string | null; expires_at: string; last_sent_at: string };
async function take(tx: Transaction, scope: string, subject: string, limit: number, seconds: number): Promise<Reservation> {
  const bucket = await digest(JSON.stringify([scope, subject]));
  const result = await tx.execute<{ retry: number; expires_at: string }>(sql`INSERT INTO quorem_auth.rate_limit(bucket,used,expires_at) VALUES(${bucket},1,clock_timestamp()+${seconds}*interval '1 second')
    ON CONFLICT(bucket) DO UPDATE SET used=CASE WHEN quorem_auth.rate_limit.expires_at<=clock_timestamp() THEN 1 ELSE quorem_auth.rate_limit.used+1 END,
    expires_at=CASE WHEN quorem_auth.rate_limit.expires_at<=clock_timestamp() THEN clock_timestamp()+${seconds}*interval '1 second' ELSE quorem_auth.rate_limit.expires_at END
    WHERE quorem_auth.rate_limit.expires_at<=clock_timestamp() OR quorem_auth.rate_limit.used<${limit}
    RETURNING GREATEST(1,CEIL(EXTRACT(EPOCH FROM expires_at-clock_timestamp())))::integer AS retry, expires_at::text AS expires_at`);
  if (result.rows.length) return { bucket, expiresAt: result.rows[0].expires_at };
  const blocked = await tx.execute<{ retry: number }>(sql`SELECT GREATEST(1,CEIL(EXTRACT(EPOCH FROM expires_at-clock_timestamp())))::integer AS retry FROM quorem_auth.rate_limit WHERE bucket=${bucket}`);
  throw new MailRateLimited(blocked.rows[0]?.retry ?? seconds);
}

export function createMailRepository(run: Run) {
  return {
    async rateLimit(scope: string, subject: string, limit: number, seconds: number): Promise<{ allowed: boolean; retryAfter: number }> {
      try { await run((tx) => take(tx, scope, subject, limit, seconds)); return { allowed: true, retryAfter: seconds }; }
      catch (error) { if (error instanceof MailRateLimited) return { allowed: false, retryAfter: error.retryAfter }; throw error; }
    },
    async create(draft: Draft): Promise<void> {
      const key = await digest(JSON.stringify([draft.email.toLowerCase(), draft.lane ?? '']));
      await run(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${draft.purpose}:${key}`}, 62))`);
        const prefix = draft.purpose === 'registration' ? 'email:registration' : 'email:account';
        const reservations = [
          await take(tx, `${prefix}:cooldown`, draft.email, 1, 60),
          await take(tx, `${prefix}:hour`, draft.email, 5, 3600),
          await take(tx, `${prefix}:global`, 'global', 100, 3600),
        ];
        const latest = await tx.execute<{ generation: number }>(sql`SELECT COALESCE(MAX(generation),0)::integer AS generation FROM quorem_auth.mail_intent WHERE purpose=${draft.purpose} AND recipient_key=${key}`);
        const generation = latest.rows[0].generation + 1;
        const encrypted = await draft.encrypt(generation);
        await tx.execute(sql`UPDATE quorem_auth.mail_intent SET state='cancelled' WHERE purpose=${draft.purpose} AND recipient_key=${key} AND state IN ('pending','sending')`);
        let previous: Previous | undefined;
        if (draft.purpose === 'registration') {
          if (!draft.tokenHash) throw new Error('Missing registration proof');
          previous = (await tx.execute<Previous>(sql`SELECT token_hash,grant_hash,expires_at::text,last_sent_at::text FROM quorem_auth.registration_email WHERE email=${draft.email} FOR UPDATE`)).rows[0];
          await tx.execute(sql`INSERT INTO quorem_auth.registration_email(email,token_hash,expires_at,last_sent_at) VALUES(${draft.email},${draft.tokenHash},clock_timestamp()+interval '1 hour',clock_timestamp()) ON CONFLICT(email) DO UPDATE SET token_hash=excluded.token_hash,grant_hash=NULL,expires_at=excluded.expires_at,last_sent_at=excluded.last_sent_at`);
        }
        await tx.execute(sql`INSERT INTO quorem_auth.mail_intent(id,purpose,recipient_key,generation,ciphertext,nonce,budget_reservations,registration_token_hash,registration_previous,state,expires_at) VALUES(${draft.id},${draft.purpose},${key},${generation},${encrypted.ciphertext},${encrypted.nonce},${JSON.stringify(reservations)}::jsonb,${draft.tokenHash ?? null},${previous ? JSON.stringify(previous) : null}::jsonb,'pending',clock_timestamp()+interval '1 hour')`);
      });
    },
    async claim(id: string): Promise<Claim | undefined> {
      const claim = crypto.randomUUID();
      return run(async (tx) => {
        await tx.execute(sql`SELECT id FROM quorem_auth.mail_intent WHERE id=${id} FOR UPDATE`);
        await tx.execute(sql`UPDATE quorem_auth.mail_intent SET state='uncertain',claim_id=NULL,claim_until=NULL WHERE id=${id} AND state='sending' AND claim_until<=clock_timestamp()`);
        const result = await tx.execute<Omit<Claim, 'claim'>>(sql`UPDATE quorem_auth.mail_intent AS i SET state='sending',claim_id=${claim},claim_until=clock_timestamp()+interval '30 seconds' WHERE i.id=${id} AND i.state='pending' AND i.expires_at>clock_timestamp() AND i.generation=(SELECT MAX(j.generation) FROM quorem_auth.mail_intent j WHERE j.purpose=i.purpose AND j.recipient_key=i.recipient_key) RETURNING i.id,i.purpose,i.recipient_key,i.generation,i.nonce,i.ciphertext`);
        return result.rows[0] ? { ...result.rows[0], claim } : undefined;
      });
    },
    async acknowledge(item: Claim, state: 'accepted' | 'rejected' | 'uncertain', email?: string): Promise<boolean> {
      return run(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${item.purpose}:${item.recipient_key}`}, 62))`);
        await tx.execute(sql`SELECT id FROM quorem_auth.mail_intent WHERE id=${item.id} FOR UPDATE`);
        const result = await tx.execute<{ budget_reservations: Reservation[]; registration_token_hash: string | null; registration_previous: Previous | null }>(sql`UPDATE quorem_auth.mail_intent AS i SET state=${state},claim_id=NULL,claim_until=NULL WHERE i.id=${item.id} AND i.state='sending' AND i.claim_id=${item.claim} AND i.claim_until>clock_timestamp() AND i.expires_at>clock_timestamp() AND i.generation=${item.generation} AND i.generation=(SELECT MAX(j.generation) FROM quorem_auth.mail_intent j WHERE j.purpose=i.purpose AND j.recipient_key=i.recipient_key) RETURNING i.budget_reservations,i.registration_token_hash,i.registration_previous`);
        const row = result.rows[0];
        if (!row) return false;
        if (state === 'rejected') {
          for (const reservation of row.budget_reservations) {
            await tx.execute(sql`SELECT bucket FROM quorem_auth.rate_limit WHERE bucket=${reservation.bucket} FOR UPDATE`);
            await tx.execute(sql`UPDATE quorem_auth.rate_limit SET used=GREATEST(0,used-1) WHERE bucket=${reservation.bucket} AND expires_at=${reservation.expiresAt}::timestamptz AND expires_at>clock_timestamp() AND used>0`);
          }
          if (item.purpose === 'registration' && email && row.registration_token_hash) {
            const previous = row.registration_previous;
            if (previous) await tx.execute(sql`UPDATE quorem_auth.registration_email SET token_hash=${previous.token_hash},grant_hash=${previous.grant_hash},expires_at=${previous.expires_at}::timestamptz,last_sent_at=${previous.last_sent_at}::timestamptz WHERE email=${email} AND token_hash=${row.registration_token_hash}`);
            else await tx.execute(sql`DELETE FROM quorem_auth.registration_email WHERE email=${email} AND token_hash=${row.registration_token_hash}`);
          }
        }
        return true;
      });
    },
    async status(grant: string): Promise<{ email: string; registered: boolean } | undefined> {
      return run(async (tx) => (await tx.execute<{ email: string; registered: boolean }>(sql`SELECT r.email,COALESCE(u."emailVerified",false) AS registered FROM quorem_auth.registration_email r LEFT JOIN quorem_auth."user" u ON u.email=r.email WHERE r.grant_hash=${grant} AND r.expires_at>clock_timestamp()`)).rows[0]);
    },
    async verify(tokenHash: string, grantHash: string): Promise<boolean> {
      return run(async (tx) => {
        await tx.execute(sql`SELECT email FROM quorem_auth.registration_email WHERE token_hash=${tokenHash} FOR UPDATE`);
        return (await tx.execute(sql`UPDATE quorem_auth.registration_email SET token_hash=NULL,grant_hash=${grantHash},expires_at=clock_timestamp()+interval '15 minutes' WHERE token_hash=${tokenHash} AND expires_at>clock_timestamp() RETURNING email`)).rows.length === 1;
      });
    },
    async complete(input: { grantHash: string; email: string; username: string; name: string; passwordHash: string }): Promise<'ok' | 'expired' | 'mismatch' | 'registered' | 'username_taken'> {
      try {
        return await run(async (tx) => {
          await tx.execute(sql`SELECT email FROM quorem_auth.registration_email WHERE grant_hash=${input.grantHash} FOR UPDATE`);
          const proof = (await tx.execute<{ email: string }>(sql`SELECT email FROM quorem_auth.registration_email WHERE grant_hash=${input.grantHash} AND expires_at>clock_timestamp()`)).rows[0];
          if (!proof) return 'expired';
          if (proof.email !== input.email) return 'mismatch';
          const existing = (await tx.execute<{ id: string; emailVerified: boolean }>(sql`SELECT id,"emailVerified" FROM quorem_auth."user" WHERE email=${proof.email} FOR UPDATE`)).rows[0];
          if (existing?.emailVerified) return 'registered';
          const id = existing?.id ?? crypto.randomUUID();
          if (existing) {
            await tx.execute(sql`DELETE FROM quorem_auth.session WHERE "userId"=${id}`);
            await tx.execute(sql`DELETE FROM quorem_auth.passkey WHERE "userId"=${id}`);
            await tx.execute(sql`DELETE FROM quorem_auth.account WHERE "userId"=${id}`);
            await tx.execute(sql`UPDATE quorem_auth."user" SET name=${input.name},username=${input.username},"displayUsername"=${input.username},"emailVerified"=true,image=NULL,"updatedAt"=clock_timestamp() WHERE id=${id}`);
          } else await tx.execute(sql`INSERT INTO quorem_auth."user"(id,name,email,"emailVerified",username,"displayUsername","createdAt","updatedAt") VALUES(${id},${input.name},${proof.email},true,${input.username},${input.username},clock_timestamp(),clock_timestamp())`);
          await tx.execute(sql`INSERT INTO quorem_auth.account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES(${crypto.randomUUID()},${id},'credential',${id},${input.passwordHash},clock_timestamp(),clock_timestamp())`);
          await tx.execute(sql`DELETE FROM quorem_auth.registration_email WHERE email=${proof.email}`);
          return 'ok';
        });
      } catch (error) { if (classifyDatabaseError(error) === 'unique') return 'username_taken'; throw error; }
    },
  };
}
export type MailRepository = ReturnType<typeof createMailRepository>;
