import { configuration } from "./config.ts";

/** Translate deployment secrets into the existing auth runtime contract. */
export function productionAuthEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  const runtime: Record<string, string> = {};
  const mailKeys = [
    "AUTH_EMAIL_DRIVER", "AUTH_EMAIL_FROM", "SMTP_HOST", "SMTP_PORT", "SMTP_USERNAME",
    "SMTP_PASSWORD", "AUTH_EMAIL_SES_REGION", "AUTH_EMAIL_CLOUDFLARE_ACCOUNT_ID",
    "AUTH_EMAIL_CLOUDFLARE_API_TOKEN",
  ];
  const mailConfigured = mailKeys.some((key) => Boolean(env[key]));
  if (mailConfigured) {
    // Preserve the existing deployment's secret-only Purelymail configuration.
    if (!env.AUTH_EMAIL_DRIVER && !env.SMTP_HOST) {
      runtime.AUTH_EMAIL_DRIVER = "smtp";
      runtime.SMTP_HOST = "smtp.purelymail.com";
      runtime.SMTP_PORT = "465";
    }
    for (const key of mailKeys) if (env[key]) runtime[key] = env[key]!;
  }
  if ((env.AUTH_MODE ?? "password") === "password")
    runtime.AUTH_LOGIN_ONLY = mailConfigured ? "false" : "true";
  for (const provider of ["GOOGLE", "GITHUB"]) {
    for (const field of ["CLIENT_ID", "CLIENT_SECRET"]) {
      // GitHub repository secrets cannot use a GITHUB_ prefix.
      const value = env[`AUTH_${provider}_${field}`];
      if (value) runtime[`${provider}_${field}`] = value;
    }
  }
  productionAuthConfiguration(env, runtime);
  return runtime;
}

export function productionAuthConfiguration(
  env: NodeJS.ProcessEnv,
  runtime: Record<string, string>,
) {
  return configuration({
    AUTH_DATABASE_URL: "postgres://configuration-only",
    ...env,
    ...runtime,
    APP_ENV: "production",
    AUTH_MODE: env.AUTH_MODE ?? "password",
    AUTH_PASSWORD_PRODUCTION: "true",
  });
}
