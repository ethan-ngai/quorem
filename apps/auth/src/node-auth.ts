import { withNodeConnection } from "@quorem/database/core";
import { composeAuth } from "./composition.ts";
import { mailIntentKey } from "./mail-key.ts";
import { createNodeDatabase } from "./database.ts";
import { createInfrastructure } from "./infrastructure.ts";
import { isolatedImageProcessor } from "./adapters/isolated-image.ts";

export async function createNodeRuntime(env: NodeJS.ProcessEnv) {
  const { config, database } = createNodeDatabase(env);
  try {
    const key = config.mail ? mailIntentKey(env.AUTH_MAIL_INTENT_KEY) : undefined;
    const { verificationMail, profileStorage } = await createInfrastructure(config);
    const run = <T>(callback: Parameters<typeof withNodeConnection<T>>[2]) =>
      withNodeConnection(database, { lifetimeMs: 15000 }, callback);
    const runtime = composeAuth({
      config,
      run,
      transport: verificationMail,
      mailKey: key,
      ...(profileStorage
        ? { media: { storage: profileStorage, processor: isolatedImageProcessor() } }
        : {}),
    });
    return {
      ...runtime,
      config,
      database,
      profileStorage,
      authRepository: runtime.repository,
      registrationHandler: runtime.registration,
      createAuth: runtime.makeAuth,
    };
  } catch (error) {
    await database.end();
    throw error;
  }
}
