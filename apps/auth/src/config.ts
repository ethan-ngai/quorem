import { isIP } from "node:net";
import { platformConfiguration } from "./platform-config.ts";
export function configuration(env: NodeJS.ProcessEnv) {
  const required = (key: string) => {
    const value = env[key];
    if (!value) throw new Error(`${key} required`);
    return value;
  };
  const origin = required("AUTH_ORIGIN");
  const url = new URL(origin);
  if (
    url.origin !== origin ||
    (url.protocol !== "https:" &&
      !(
        env.APP_ENV === "local" &&
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      ))
  )
    throw new Error("AUTH_ORIGIN must be an exact HTTPS origin (local loopback excepted)");
  const secret = required("BETTER_AUTH_SECRET");
  if (secret.length < 32) throw new Error("BETTER_AUTH_SECRET must have at least 32 characters");
  const method = env.AUTH_MODE ?? "cognito";
  if (method !== "cognito" && method !== "password") throw new Error("Invalid AUTH_MODE");
  const platform = platformConfiguration(env);
  if (
    platform.mail?.driver === "relay" &&
    [env.BETTER_AUTH_SECRET, env.AUTH_INTERNAL_SECRET, env.AUTH_MAIL_INTENT_KEY].includes(
      platform.mail.token,
    )
  )
    throw new Error("Distinct mail relay credential required");
  if (platform.mail && !env.AUTH_EMAIL_DRIVER && method !== "password")
    throw new Error("Legacy local SMTP requires password mode");
  const localPassword =
    env.APP_ENV === "local" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (
    env.AUTH_PASSWORD_PRODUCTION !== undefined &&
    !["true", "false"].includes(env.AUTH_PASSWORD_PRODUCTION)
  )
    throw new Error("AUTH_PASSWORD_PRODUCTION must be true or false");
  if (env.AUTH_LOGIN_ONLY !== undefined && !["true", "false"].includes(env.AUTH_LOGIN_ONLY))
    throw new Error("AUTH_LOGIN_ONLY must be true or false");
  const loginOnly = env.AUTH_LOGIN_ONLY === "true";
  if (loginOnly && (method !== "password" || platform.mail))
    throw new Error("Login-only mode requires password authentication without email delivery");
  if (
    method === "password" &&
    !localPassword &&
    !(
      env.AUTH_PASSWORD_PRODUCTION === "true" &&
      url.protocol === "https:" &&
      (loginOnly ||
        (platform.mail &&
          (platform.mail.driver === "cloudflare" ||
            platform.mail.driver === "relay" ||
            platform.mail.requireTLS)))
    )
  )
    throw new Error(
      "Production password mode requires HTTPS, explicit opt-in and external email delivery or login-only mode",
    );
  const provider = (key: string) => (method === "cognito" ? required(key) : "");
  const pair = (prefix: string) => {
    const clientId = env[`${prefix}_CLIENT_ID`];
    const clientSecret = env[`${prefix}_CLIENT_SECRET`];
    if (Boolean(clientId) !== Boolean(clientSecret))
      throw new Error(`${prefix} requires both client ID and secret`);
    return clientId && clientSecret ? { clientId, clientSecret } : undefined;
  };
  const google = pair("GOOGLE");
  const apple = pair("APPLE");
  const github = pair("GITHUB");
  if (env.AUTH_PASSKEYS !== undefined && !["true", "false"].includes(env.AUTH_PASSKEYS))
    throw new Error("AUTH_PASSKEYS must be true or false");
  return {
    registration: method === "password" && Boolean(platform.mail),
    mail: platform.mail,
    avatars: platform.avatars,
    localPassword,
    passkey: env.AUTH_PASSKEYS !== "false" && isIP(url.hostname.replace(/^\[|\]$/g, "")) === 0,
    social: { google, apple, github },
    method,
    origin,
    secret,
    database: required("AUTH_DATABASE_URL"),
    internalSecret: required("AUTH_INTERNAL_SECRET"),
    clientId: provider("COGNITO_CLIENT_ID"),
    clientSecret: provider("COGNITO_CLIENT_SECRET"),
    domain: provider("COGNITO_DOMAIN"),
    region: provider("COGNITO_REGION"),
    userPoolId: provider("COGNITO_USERPOOL_ID"),
  };
}
