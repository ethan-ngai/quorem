import { config } from "./database.ts";
import { verificationMailer } from "./mailer.ts";

// Composition owns provider choices; account and profile rules consume only ports.
const mail = config.mail;
export const verificationMail = mail
  ? verificationMailer(
      mail.driver === "cloudflare"
        ? (await import("./adapters/cloudflare-email.ts")).cloudflareEmail(mail)
        : (await import("./adapters/smtp-email.ts")).smtpEmail(mail),
    )
  : undefined;
const avatars = config.avatars;
export const profileStorage = !avatars
  ? undefined
  : avatars.driver === "r2"
    ? (await import("./adapters/s3-profile-storage.ts")).r2ProfileStorage(avatars)
    : (await import("./adapters/s3-profile-storage.ts")).s3ProfileStorage(avatars.bucket, {
        region: avatars.region,
        ...(avatars.endpoint ? { endpoint: avatars.endpoint, forcePathStyle: true } : {}),
        ...(avatars.credentials ? { credentials: avatars.credentials } : {}),
      });
