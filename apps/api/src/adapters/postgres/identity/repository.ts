import { and, eq, sql } from 'drizzle-orm';
import { product } from '@quorem/database/schema';
import type { ConnectionScope, Transaction } from '@quorem/database/core';
import { IdentityError, type Claims, type IdentityBindings, type Principal } from '../../../modules/identity/model.ts';

const { users, identity_bindings: bindings } = product;
const transactionOptions = { statementTimeoutMs: 3000, lockTimeoutMs: 1000 };
async function read(tx: Transaction, claims: Claims) {
  const [row] = await tx.select({ id:users.id, name:users.display_name, role:users.role, disabled:users.disabled, image:users.profile_image, revision:users.profile_color_revision })
    .from(users).innerJoin(bindings,eq(bindings.user_id,users.id))
    .where(and(eq(bindings.issuer,claims.issuer),eq(bindings.subject,claims.subject))).limit(1);
  if (!row) return null;
  if (row.disabled) throw new IdentityError('unauthorized');
  const principal: Principal = {userId:row.id, displayName:row.name, admin:row.role==='admin', emailVerified:true, sessionId:claims.sessionId, strongUntil:0};
  return {principal, image:row.image, revision:row.revision};
}
export function identityRepository(scope: ConnectionScope): IdentityBindings {
  return {
    async lookup(claims) {
      return scope.transaction({...transactionOptions, readOnly:true}, async tx => {
        const row = await read(tx,claims);
        return row ? {principal:row.principal,current:row.image===claims.image && row.revision>=claims.colorRevision} : null;
      });
    },
    async resolve(claims) {
      return scope.transaction(transactionOptions, async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${claims.issuer + ':' + claims.subject},0))`);
        let row=await read(tx,claims);
        if (!row) {
          const id=crypto.randomUUID();
          await tx.insert(users).values({id,participant_id:id,display_name:claims.name});
          await tx.insert(bindings).values({issuer:claims.issuer,subject:claims.subject,user_id:id});
          row=await read(tx,claims);
          if (!row) throw new Error('Identity binding creation failed');
        }
        if (row.image!==claims.image || row.revision<claims.colorRevision) {
          const color=claims.color>=0 && claims.color<=24 ? claims.color : 0;
          await tx.update(users).set({profile_image:claims.image,profile_color:sql`CASE WHEN ${users.profile_color_revision} < ${claims.colorRevision} THEN ${color} ELSE ${users.profile_color} END`,profile_color_revision:sql`GREATEST(${users.profile_color_revision},${claims.colorRevision})`}).where(eq(users.id,row.principal.userId));
        }
        return row.principal;
      });
    },
  };
}

export async function developmentIdentity(scope: ConnectionScope, userId: string): Promise<Principal> {
  return scope.transaction({...transactionOptions,readOnly:true},async tx => {
    const [user]=await tx.select({name:users.display_name,role:users.role,disabled:users.disabled}).from(users).where(eq(users.id,userId)).limit(1);
    if (!user || user.disabled) throw new IdentityError('unauthorized');
    return {userId,displayName:user.name,admin:user.role==='admin',emailVerified:true,sessionId:'development',strongUntil:0};
  });
}
