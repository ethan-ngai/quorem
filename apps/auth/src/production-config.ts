import { configuration } from "./config.ts";

/** Translate deployment secrets into the existing auth runtime contract. */
export function productionAuthEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  const runtime: Record<string, string> = { AUTH_LOGIN_ONLY: "true" };
  const mail = [env.SMTP_USERNAME, env.SMTP_PASSWORD, env.AUTH_EMAIL_FROM];
  if (mail.some(Boolean)) {
    for (const key of ["SMTP_USERNAME", "SMTP_PASSWORD", "AUTH_EMAIL_FROM"])
      if (!env[key]) throw new Error(`${key} required for production email`);
    Object.assign(runtime, {
      AUTH_LOGIN_ONLY: "false",
      AUTH_EMAIL_DRIVER: "smtp",
      SMTP_HOST: "smtp.purelymail.com",
      SMTP_PORT: "465",
      SMTP_USERNAME: env.SMTP_USERNAME!,
      SMTP_PASSWORD: env.SMTP_PASSWORD!,
      AUTH_EMAIL_FROM: env.AUTH_EMAIL_FROM!,
    });
  }
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
    AUTH_MODE: "password",
    AUTH_PASSWORD_PRODUCTION: "true",
  });
}
