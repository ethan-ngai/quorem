import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { config, database } from "./database.ts";
export { config, database } from "./database.ts";
export const auth = betterAuth({
  baseURL: config.origin,
  secret: config.secret,
  database,
  trustedOrigins: [config.origin],
  emailAndPassword: { enabled: false },
  account: { accountLinking: { enabled: false } },
  socialProviders: {
    cognito: {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      domain: config.domain,
      region: config.region,
      userPoolId: config.userPoolId,
      pkce: true,
    },
  },
  session: { cookieCache: { enabled: false } },
  advanced: { useSecureCookies: new URL(config.origin).protocol === "https:" },
  plugins: [
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
