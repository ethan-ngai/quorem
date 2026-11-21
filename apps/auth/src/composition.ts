import { createProfileHandler } from "./profile.ts";
import { drizzleProfileBudget } from "./adapters/drizzle-profile-budget.ts";
import { drizzleProfileRepository } from "./adapters/drizzle-profile-repository.ts";
import type { ProfileStorage } from "./profile-storage.ts";
import type { ImageProcessor } from "./image-processing.ts";
import type { ConnectionScope } from "@quorem/database/core";
import type { configuration } from "./config.ts";
import type { VerificationSender } from "./email-delivery.ts";
import { accountEmails } from "./emails/content.ts";
import { createSudoHandler } from "./sudo.ts";
import { createAuth } from "./auth.ts";
import { createAuthApp } from "./http.ts";
import { socialEmail } from "./social-email.ts";
import { createRegistrationHandler } from "./registration.ts";
import { accountMailer, accountVerificationSender } from "./account-mailer.ts";
import { createMailIntentService } from "./mail-intent.ts";
import { createMailRepository } from "./mail-repository.ts";
import { drizzleAuthRepository } from "./adapters/drizzle-auth-repository.ts";
import { scopedDrizzleAdapter } from "./adapters/scoped-drizzle.ts";
import { getSessionCookie } from "better-auth/cookies";

type RunScope = <T>(callback: (scope: ConnectionScope) => Promise<T>) => Promise<T>;
export function composeAuth(options: {
  config: ReturnType<typeof configuration>;
  run: RunScope;
  transport?: VerificationSender;
  mailKey?: Uint8Array;
  media?: { storage: ProfileStorage; processor: ImageProcessor };
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
      rateLimit: (scope, subject, policy) => repository.rateLimit(scope, subject, policy),
      recordAssurance: (id) => repository.recordAssurance(id),
      checkAssurance: (id, subject) => repository.sessionAuthority(id, subject),
    });
  const auth = makeAuth();
  const cookieSession = {
    present: (request: Request) => Boolean(getSessionCookie(request)),
    async read(headers: Headers, refresh: boolean) {
      const signed = await auth.api.signedBrowserSession({ headers });
      if (!signed) return;
      const current = await repository.browserSession(signed.token);
      if (!current) return;
      const renewal =
        refresh &&
        signed.updateAge > 0 &&
        current.updatedAt + signed.updateAge <= Math.floor(Date.now() / 1000)
          ? await auth.api.getSession({ headers, returnHeaders: true })
          : undefined;
      if (
        renewal &&
        (!renewal.response?.user.emailVerified || renewal.response.session.id !== current.sessionId)
      )
        return;
      return {
        issuer: config.origin,
        subject: current.subject,
        sessionId: current.sessionId,
        expiresAt: renewal
          ? Math.floor(new Date(renewal.response!.session.expiresAt).getTime() / 1000)
          : current.expiresAt,
        emailVerified: true as const,
        name: current.name,
        image:
          current.image && /^\/api\/auth\/profile-photos\/[a-f0-9-]{36}$/.test(current.image)
            ? current.image
            : "",
        color: current.color,
        colorRevision: current.colorRevision,
        strongAt: current.strongAt,
        setCookies: renewal?.headers.getSetCookie() ?? [],
      };
    },
  };
  const registration =
    config.registration && mail
      ? createRegistrationHandler({ repository: mailRepository, mail, origin: config.origin })
      : undefined;
  const sudo = createSudoHandler({
    auth,
    repository,
    origin: config.origin,
    secret: config.secret,
    passkey: config.passkey,
    send: mail
      ? (email, code) =>
          accountMailer(mail)(
            email,
            code,
            accountEmails.sudo.subject,
            accountEmails.sudo.instruction,
          )
      : undefined,
  });
  const profile = createProfileHandler({
    origin: config.origin,
    session: (headers) => auth.api.getSession({ headers }),
    repository: drizzleProfileRepository(run),
    budget: drizzleProfileBudget(run),
    storage: options.media?.storage,
    imageProcessor: options.media?.processor,
  });
  return {
    auth,
    makeAuth,
    repository,
    cookieSession,
    registration,
    app: createAuthApp({ config, auth, registration, profile, sudo }),
  };
}
