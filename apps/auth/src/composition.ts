import type { ConnectionScope } from "@quorem/database/core";
import type { configuration } from "./config.ts";
import type { VerificationSender } from "./email-delivery.ts";
import { createAuth } from "./auth.ts";
import { createAuthApp } from "./http.ts";
import { socialEmail } from "./social-email.ts";
import { createRegistrationHandler } from "./registration.ts";
import { accountMailer, accountVerificationSender } from "./account-mailer.ts";
import { createMailIntentService } from "./mail-intent.ts";
import { createMailRepository } from "./mail-repository.ts";
import { drizzleAuthRepository } from "./adapters/drizzle-auth-repository.ts";
import { scopedDrizzleAdapter } from "./adapters/scoped-drizzle.ts";

type RunScope = <T>(callback: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
export function composeAuth(options: {
  config: ReturnType<typeof configuration>;
  run: RunScope;
  transport?: VerificationSender;
  mailKey?: Uint8Array;
}) {
  const { config, run, transport, mailKey } = options;
  if (
    Boolean(config.mail) !== Boolean(transport) ||
    (transport && (!mailKey || mailKey.byteLength !== 32))
  )
    throw new Error("Configured email delivery requires a transport and a 32-byte mail intent key");
  const repository = drizzleAuthRepository(run);
  const mailRepository = createMailRepository((callback) =>
    run((scope) => scope.transaction({ statementTimeoutMs: 5000, lockTimeoutMs: 5000 }, callback)),
  );
  const mail =
    transport && mailKey
      ? createMailIntentService({ repository: mailRepository, key: mailKey, deliver: transport })
      : undefined;
  const socialSender = mail ? accountVerificationSender(mail) : undefined;
  const makeAuth = (allowSeed = false) =>
    createAuth({
      config,
      allowSeed,
      adapter: scopedDrizzleAdapter(run),
      emailFlow: socialEmail(repository, config.origin, socialSender),
      accountMail: mail ? accountMailer(mail) : undefined,
      rateLimit: repository.rateLimit,
      profile: repository.profile,
      recordAssurance: repository.recordAssurance,
    });
  const auth = makeAuth();
  const registration =
    config.registration && mail
      ? createRegistrationHandler({ repository: mailRepository, mail, origin: config.origin })
      : undefined;
  return {
    auth,
    makeAuth,
    repository,
    registration,
    app: createAuthApp({ config, auth, registration }),
  };
}
