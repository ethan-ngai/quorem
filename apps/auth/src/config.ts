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
      !(env.APP_ENV === "local" && ["localhost", "127.0.0.1"].includes(url.hostname)))
  )
    throw new Error("AUTH_ORIGIN must be an exact HTTPS origin (local loopback excepted)");
  const secret = required("BETTER_AUTH_SECRET");
  if (secret.length < 32) throw new Error("BETTER_AUTH_SECRET must have at least 32 characters");
  const method = env.AUTH_MODE ?? "cognito";
  if (method !== "cognito" && method !== "password") throw new Error("Invalid AUTH_MODE");
  if (
    method === "password" &&
    (env.APP_ENV !== "local" || !["localhost", "127.0.0.1"].includes(url.hostname))
  )
    throw new Error("Password mode requires explicit local loopback origin");
  const provider = (key: string) => (method === "cognito" ? required(key) : "");
  return {
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
