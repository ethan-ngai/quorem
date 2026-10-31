import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { createNodePool, withNodeConnection } from '@quorem/database/core';
import { migrate } from '@quorem/database/migrations';
import { identityRepository } from './repository.ts';
import { capabilityRepository } from '../access/repository.ts';
import type { Claims } from '../../../modules/identity/model.ts';

const url=process.env.QUOREM_IDENTITY_TEST_DATABASE_URL;
describe.skipIf(!url)('identity and access on disposable PostgreSQL',()=>{
  it('binds provider subjects, projects profiles and reads live roles and grants',async()=>{
    const parsed=new URL(url!); expect(parsed.port).toBe('55437'); expect(parsed.pathname).toBe('/quorem_hono_identity_test');
    const pool=createNodePool({connectionString:url!,max:4,connectionTimeoutMs:2000,idleTimeoutMs:5000,onIdleError:()=>{}});
    try {
      await migrate(pool,'product',resolve('../../apps/api/migrations'));
      const suffix=crypto.randomUUID();
      const claims:Claims={issuer:'https://fixture.test',subject:suffix,sessionId:'session',emailVerified:true,name:'Fixture',image:'/photo',color:7,colorRevision:10n};
      const run=<T>(fn:(scope:Parameters<typeof identityRepository>[0])=>Promise<T>)=>withNodeConnection(pool,{lifetimeMs:10000},fn);
      const principal=await run(scope=>identityRepository(scope).resolve(claims));
      expect(principal.admin).toBe(false);
      expect((await run(scope=>identityRepository(scope).lookup(claims)))?.current).toBe(true);
      const [row]=(await pool.query('SELECT profile_color,profile_color_revision,profile_image FROM users WHERE id=$1',[principal.userId])).rows;
      expect(row).toMatchObject({profile_color:7,profile_color_revision:'10',profile_image:'/photo'});
      await run(scope=>identityRepository(scope).resolve({...claims,color:2,colorRevision:9n,image:'/new'}));
      const updated=(await pool.query('SELECT profile_color,profile_color_revision,profile_image FROM users WHERE id=$1',[principal.userId])).rows[0];
      expect(updated).toMatchObject({profile_color:7,profile_color_revision:'10',profile_image:'/new'});
      const other=await run(scope=>identityRepository(scope).resolve({...claims,issuer:'https://other.test'}));
      expect(other.userId).not.toBe(principal.userId);
      await pool.query("UPDATE users SET role='admin' WHERE id=$1",[principal.userId]);
      expect((await run(scope=>identityRepository(scope).lookup(claims)))?.principal.admin).toBe(true);
      let caps=await run(scope=>capabilityRepository(scope).capabilities(principal.userId));
      expect(caps).toMatchObject({authorCustomQuestions:true,hostGuests:false,interviews:false,guestConcurrency:2,interviewConcurrency:1});
      await pool.query("INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES($1,$2,'interviews.host','manual','fixture','fixture','fixture')",[crypto.randomUUID(),principal.userId]);
      await pool.query("INSERT INTO quota_overrides(user_id,resource,value,actor,reason) VALUES($1,'guest_concurrency',20,'fixture','fixture')",[principal.userId]);
      caps=await run(scope=>capabilityRepository(scope).capabilities(principal.userId));
      expect(caps).toMatchObject({interviews:true,hostGuests:false,guestConcurrency:8});
      await pool.query('UPDATE entitlement_grants SET revoked_at=clock_timestamp() WHERE user_id=$1',[principal.userId]);
      expect((await run(scope=>capabilityRepository(scope).capabilities(principal.userId))).interviews).toBe(false);
      await pool.query('UPDATE users SET disabled=true WHERE id=$1',[principal.userId]);
      await expect(run(scope=>identityRepository(scope).lookup(claims))).rejects.toMatchObject({kind:'unauthorized'});
      expect((await run(scope=>capabilityRepository(scope).capabilities(principal.userId))).authorCustomQuestions).toBe(false);
    } finally {await pool.end();}
  });
});
