import { betterAuth } from "better-auth";
import { jwt, username } from "better-auth/plugins";
import { config, database } from "./database.ts";
export { config, database } from "./database.ts";
export function createAuth(allowSeed = false) {
  if (allowSeed && config.method !== "password")
    throw new Error("Seeding requires local password mode");
  return betterAuth({
    baseURL: config.origin,
    secret: config.secret,
    database,
    trustedOrigins: [config.origin],
    emailAndPassword: {
      enabled: config.method === "password",
      disableSignUp: !allowSeed,
      autoSignIn: false,
    },
    account: { accountLinking: { enabled: false } },
    socialProviders:
      config.method === "cognito"
        ? {
            cognito: {
              clientId: config.clientId,
              clientSecret: config.clientSecret,
              domain: config.domain,
              region: config.region,
              userPoolId: config.userPoolId,
              pkce: true,
            },
          }
        : {},
    session: { cookieCache: { enabled: false } },
    advanced: { useSecureCookies: new URL(config.origin).protocol === "https:" },
    plugins: [
      ...(config.method === "password" ? [username({ immutableUsername: true })] : []),
      jwt({
        jwks: {
          keyPairConfig: { alg: "EdDSA", crv: "Ed25519" },
          rotationInterval: 86400,
          gracePeriod: 600,
        },
        jwt: {
          issuer: config.origin,
          audience: "quorem-api",
          expirationTime: "5m",
          definePayload: ({ user, session }) => ({
            emailVerified: user.emailVerified === true,
            name: user.name,
            sessionId: session.id,
          }),
        },
      }),
    ],
  });
}
export const auth = createAuth();
