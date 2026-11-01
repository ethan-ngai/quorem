import type { SMTPConfiguration } from "./adapters/smtp-email.ts";

export type MailConfiguration =
  | ({ driver: "smtp" | "ses-smtp" } & SMTPConfiguration)
  | { driver: "relay"; origin: string; token: string; from: string }
  | { driver: "cloudflare"; accountId: string; apiToken: string; from: string };
export type AvatarConfiguration =
  | {
      driver: "s3";
      bucket: string;
      region: string;
      endpoint?: string;
      credentials?: { accessKeyId: string; secretAccessKey: string };
    }
  | {
      driver: "r2";
      bucket: string;
      accountId: string;
      accessKeyId: string;
      secretAccessKey: string;
    };

export function platformConfiguration(env: NodeJS.ProcessEnv) {
  const required = (key: string) => {
    const value = env[key];
    if (!value) throw new Error(`${key} required`);
    return value;
  };
  const account = (key: string) => {
    const value = required(key);
    if (!/^[a-f0-9]{32}$/.test(value)) throw new Error(`Invalid ${key}`);
    return value;
  };
  const local = env.APP_ENV === "local";
  const loopback = (host: string) => ["localhost", "127.0.0.1"].includes(host);
  let mail: MailConfiguration | undefined;
  const driver = env.AUTH_EMAIL_DRIVER ?? (env.SMTP_HOST ? "smtp" : undefined);
  if (driver === "relay") {
    const origin = required("AUTH_EMAIL_RELAY_ORIGIN"),
      token = required("AUTH_EMAIL_RELAY_TOKEN");
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error("Invalid email relay origin");
    }
    if (
      url.origin !== origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" &&
        !(local && url.protocol === "http:" && loopback(url.hostname))) ||
      new TextEncoder().encode(token).length < 32 ||
      /\s/.test(token)
    )
      throw new Error("Invalid email relay configuration");
    mail = { driver, origin, token, from: required("AUTH_EMAIL_FROM") };
  } else if (driver === "cloudflare") {
    mail = {
      driver,
      accountId: account("AUTH_EMAIL_CLOUDFLARE_ACCOUNT_ID"),
      apiToken: required("AUTH_EMAIL_CLOUDFLARE_API_TOKEN"),
      from: required("AUTH_EMAIL_FROM"),
    };
  } else if (driver === "smtp" || driver === "ses-smtp") {
    const host =
      driver === "ses-smtp"
        ? `email-smtp.${required("AUTH_EMAIL_SES_REGION")}.amazonaws.com`
        : required("SMTP_HOST");
    if (!/^[a-z0-9.-]+$/i.test(host)) throw new Error("Invalid SMTP host");
    const external = !(local && loopback(host));
    if (external && !env.AUTH_EMAIL_DRIVER)
      throw new Error("External SMTP requires explicit AUTH_EMAIL_DRIVER");
    const port = Number(env.SMTP_PORT ?? (external ? "465" : "51025"));
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid SMTP_PORT");
    if (external && ![465, 587, 2465, 2587].includes(port))
      throw new Error("External SMTP requires a TLS submission port");
    if (Boolean(env.SMTP_USERNAME) !== Boolean(env.SMTP_PASSWORD))
      throw new Error("Both SMTP credentials required");
    const auth = external
      ? { user: required("SMTP_USERNAME"), pass: required("SMTP_PASSWORD") }
      : env.SMTP_USERNAME
        ? { user: env.SMTP_USERNAME, pass: env.SMTP_PASSWORD! }
        : undefined;
    mail = {
      driver,
      host,
      port,
      from:
        env.AUTH_EMAIL_FROM ??
        env.SMTP_FROM ??
        (external ? required("AUTH_EMAIL_FROM") : "Quorem <accounts@quorem.local>"),
      secure: external && [465, 2465].includes(port),
      requireTLS: external,
      ...(auth ? { auth } : {}),
    };
  } else if (driver !== undefined) throw new Error("Invalid AUTH_EMAIL_DRIVER");
  if (mail && /[\r\n]/.test(mail.from)) throw new Error("Invalid email sender");

  let avatars: AvatarConfiguration | undefined;
  const avatarDriver = env.AVATAR_STORAGE_DRIVER ?? (env.AVATAR_S3_BUCKET ? "s3" : undefined);
  if (avatarDriver === "r2") {
    avatars = {
      driver: avatarDriver,
      bucket: required("AVATAR_R2_BUCKET"),
      accountId: account("AVATAR_R2_ACCOUNT_ID"),
      accessKeyId: required("AVATAR_R2_ACCESS_KEY_ID"),
      secretAccessKey: required("AVATAR_R2_SECRET_ACCESS_KEY"),
    };
  } else if (avatarDriver === "s3") {
    if (Boolean(env.AVATAR_S3_ACCESS_KEY_ID) !== Boolean(env.AVATAR_S3_SECRET_ACCESS_KEY))
      throw new Error("Both avatar S3 credentials required");
    const endpoint = env.AVATAR_S3_ENDPOINT;
    if (endpoint) {
      const url = new URL(endpoint);
      if (
        url.username ||
        url.password ||
        (url.protocol !== "https:" &&
          !(local && loopback(url.hostname) && url.protocol === "http:"))
      )
        throw new Error("Avatar endpoint requires HTTPS or local loopback");
    }
    avatars = {
      driver: avatarDriver,
      bucket: required("AVATAR_S3_BUCKET"),
      region: env.AVATAR_S3_REGION ?? "us-east-1",
      ...(endpoint ? { endpoint } : {}),
      ...(env.AVATAR_S3_ACCESS_KEY_ID
        ? {
            credentials: {
              accessKeyId: env.AVATAR_S3_ACCESS_KEY_ID,
              secretAccessKey: env.AVATAR_S3_SECRET_ACCESS_KEY!,
            },
          }
        : {}),
    };
  } else if (avatarDriver !== undefined) throw new Error("Invalid AVATAR_STORAGE_DRIVER");
  return { mail, avatars };
}
