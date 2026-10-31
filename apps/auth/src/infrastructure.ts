import type { configuration } from "./config.ts";
import { verificationMailer } from "./mailer.ts";

export async function createInfrastructure(config: ReturnType<typeof configuration>) {
  const mail = config.mail;
  const verificationMail = mail
    ? verificationMailer(
        mail.driver === "cloudflare"
          ? (await import("./adapters/cloudflare-email.ts")).cloudflareEmail(mail)
          : (await import("./adapters/smtp-email.ts")).smtpEmail(mail),
      )
    : undefined;
  const avatars = config.avatars;
  const profileStorage = !avatars
    ? undefined
    : avatars.driver === "r2"
      ? (await import("./adapters/s3-profile-storage.ts")).r2ProfileStorage(avatars)
      : (await import("./adapters/s3-profile-storage.ts")).s3ProfileStorage(avatars.bucket, {
          region: avatars.region,
          ...(avatars.endpoint ? { endpoint: avatars.endpoint, forcePathStyle: true } : {}),
          ...(avatars.credentials ? { credentials: avatars.credentials } : {}),
        });
  return { verificationMail, profileStorage };
}
