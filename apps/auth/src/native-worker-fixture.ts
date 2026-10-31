import { withWorkerConnection } from "@quorem/database/core";
import { configuration } from "./config.ts";
import { createAuth } from "./auth.ts";
import { socialEmail } from "./social-email.ts";
import { createAuthApp } from "./http.ts";
import { scopedDrizzleAdapter } from "./adapters/scoped-drizzle.ts";
import { drizzleAuthRepository } from "./adapters/drizzle-auth-repository.ts";

interface Env { DB: {connectionString: string} }
export default {
  async fetch(request: Request, env: Env) {
    const config=configuration({APP_ENV:"local",AUTH_MODE:"password",AUTH_ORIGIN:"http://localhost:58738",AUTH_DATABASE_URL:env.DB.connectionString,AUTH_INTERNAL_SECRET:"fixture-only",BETTER_AUTH_SECRET:"mock-secret-".repeat(4)});
    const run=<T>(callback:Parameters<typeof withWorkerConnection<T>>[2])=>withWorkerConnection(env.DB.connectionString,{connectionTimeoutMs:2000,lifetimeMs:15000},callback);
    const repository=drizzleAuthRepository(run);
    const dependencies={config,adapter:scopedDrizzleAdapter(run),emailFlow:socialEmail(repository,config.origin),rateLimit:repository.rateLimit,profile:repository.profile,recordAssurance:repository.recordAssurance};
    const url=new URL(request.url);
    if (url.pathname==='/fixture/authority') return Response.json(await repository.sessionAuthority(url.searchParams.get('session') ?? '',url.searchParams.get('subject') ?? ''));
    if (url.pathname==='/fixture/signup') {
      const next=new URL('/api/auth/sign-up/email',request.url);
      return createAuth({...dependencies,allowSeed:true}).handler(new Request(next,request));
    }
    const app=createAuthApp({config,auth:createAuth(dependencies)});
    return app.fetch(request);
  },
};
