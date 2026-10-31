import { withNodeConnection } from "@quorem/database/core";
import { scopedDrizzleAdapter } from "./adapters/scoped-drizzle.ts";
import { createAuth as createAuthFactory } from "./auth.ts";
import { accountMailer } from "./account-mailer.ts";
import { socialEmail } from "./social-email.ts";
import { drizzleAuthRepository } from "./adapters/drizzle-auth-repository.ts";
import { config, database } from "./database.ts";
import { verificationMail } from "./infrastructure.ts";

export { config, database };
const run = <T>(callback: Parameters<typeof withNodeConnection<T>>[2]) => withNodeConnection(database, { lifetimeMs: 15000 }, callback);
export const authRepository = drizzleAuthRepository(run);
export function createAuth(allowSeed = false) {
  const repository = authRepository;
  return createAuthFactory({
    config, allowSeed,
    accountMail: verificationMail ? accountMailer(database, verificationMail) : undefined,
    emailFlow: socialEmail(repository, config.origin, verificationMail),
    rateLimit: repository.rateLimit,
    profile: repository.profile,
    recordAssurance: repository.recordAssurance,
    adapter: scopedDrizzleAdapter(run),
  });
}
export const auth = createAuth();
