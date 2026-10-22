import { config } from "./database.ts";
import { smtpEmail } from "./adapters/smtp-email.ts";
import { cloudflareEmail } from "./adapters/cloudflare-email.ts";
import { s3ProfileStorage, r2ProfileStorage } from "./adapters/s3-profile-storage.ts";
import { verificationMailer } from "./mailer.ts";

// Composition owns provider choices; account and profile rules consume only ports.
const mail = config.mail;
export const verificationMail = mail
  ? verificationMailer(mail.driver === "cloudflare" ? cloudflareEmail(mail) : smtpEmail(mail))
  : undefined;
const avatars = config.avatars;
export const profileStorage = !avatars
  ? undefined
  : avatars.driver === "r2"
    ? r2ProfileStorage(avatars)
    : s3ProfileStorage(avatars.bucket, {
        region: avatars.region,
        ...(avatars.endpoint ? { endpoint: avatars.endpoint, forcePathStyle: true } : {}),
        ...(avatars.credentials ? { credentials: avatars.credentials } : {}),
      });
