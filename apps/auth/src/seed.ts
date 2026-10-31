import { createNodeRuntime } from "./node-auth.ts";
import { seedAccounts } from "./seed-accounts.ts";

export async function seed(env: NodeJS.ProcessEnv = process.env) {
  const runtime = await createNodeRuntime(env);
  try {
    console.log(
      JSON.stringify(await seedAccounts(runtime, env.AUTH_SEED_PASSWORD ?? "", env.DATABASE_URL)),
    );
  } finally {
    await runtime.database.end();
  }
}
if (import.meta.main) await seed();
