import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { jwt, username } from "better-auth/plugins";
import { verificationMailer } from "./mailer.ts";
import { config, database } from "./database.ts";
export { config, database } from "./database.ts";
export function createAuth(allowSeed = false) {
  if (allowSeed && config.method !== "password")
    throw new Error("Seeding requires local password mode");
  const sendVerification = !allowSeed && config.mail ? verificationMailer(config.mail) : undefined;
  return betterAuth({
    baseURL: config.origin,
    secret: config.secret,
    database,
    trustedOrigins: [config.origin],
    emailAndPassword: {
      enabled: config.method === "password",
      disableSignUp: !allowSeed && !config.registration,
      requireEmailVerification: !allowSeed,
      minPasswordLength: 12,
      autoSignIn: false,
    },
    emailVerification: {
      sendOnSignUp: Boolean(sendVerification),
      sendOnSignIn: Boolean(sendVerification),
      autoSignInAfterVerification: false,
      expiresIn: 3600,
      ...(sendVerification
        ? {
            sendVerificationEmail: async ({
              user,
              url,
            }: {
              user: { email: string };
              url: string;
            }) => {
              const verificationURL = new URL(url);
              if (verificationURL.searchParams.get("callbackURL") === "/")
                verificationURL.searchParams.set(
                  "callbackURL",
                  `${config.origin}/login?verified=1`,
                );
              await sendVerification(user.email, verificationURL.toString());
            },
          }
        : {}),
    },
    rateLimit: {
      enabled: !allowSeed,
      window: 60,
      max: 30,
      customRules: {
        "/sign-up/email": { window: 60, max: 5 },
        "/send-verification-email": { window: 60, max: 3 },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Passkey plugin management routes must share profile mutations' exact origin policy.
        if (
          (ctx.path.startsWith("/passkey/") ||
            ctx.path === "/sign-up/email" ||
            ctx.path === "/send-verification-email") &&
          ctx.method === "POST" &&
          ctx.headers?.get("origin") !== config.origin
        )
          throw new APIError("FORBIDDEN", { message: "Invalid origin" });
      }),
    },
    account: { accountLinking: { enabled: false } },
    socialProviders: {
      ...config.social,
      ...(config.method === "cognito"
        ? {
            cognito: {
              clientId: config.clientId,
              clientSecret: config.clientSecret,
              domain: config.domain,
              region: config.region,
              userPoolId: config.userPoolId,
            },
          }
        : {}),
    },
    session: { cookieCache: { enabled: false } },
    databaseHooks: {
      user: {
        create: { before: async (user) => ({ data: { ...user, image: null } }) },
        update: {
          before: async (user, context) => {
            if (Object.hasOwn(user, "image")) {
              if (context?.path === "/update-user" && Object.hasOwn(context.body ?? {}, "image"))
                throw new APIError("BAD_REQUEST", {
                  message: "Use the profile photo upload endpoint",
                });
              // Provider refreshes cannot replace a server-owned S3 photo.
              const { image: _image, ...data } = user;
              return { data };
            }
          },
        },
      },
    },
    advanced: { useSecureCookies: new URL(config.origin).protocol === "https:" },
    plugins: [
      ...(config.passkey
        ? [
            passkey({
              rpID: new URL(config.origin).hostname,
              rpName: "Quorem",
              origin: config.origin,
              registration: { requireSession: true },
            }),
          ]
        : []),
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
