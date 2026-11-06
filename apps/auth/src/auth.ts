import { sudoExpiresAt } from "@quorem/contracts/auth-policy";
import { passkey } from "@better-auth/passkey";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import type { configuration } from "./config.ts";
import { createAuthMiddleware, getSessionFromCtx, APIError } from "better-auth/api";
import { google, apple, github, cognito } from "better-auth/social-providers";
import type { socialEmail } from "./social-email.ts";
import { accountEmails } from "./emails/content.ts";
import { jwt, username, lastLoginMethod } from "better-auth/plugins";
import {
  emailSchema,
  usernameSchema,
  optionalNameSchema,
  passwordSchema,
} from "@quorem/contracts/auth";
export function createAuth(options: {
  config: ReturnType<typeof configuration>;
  accountMail?: (email: string, url: string, subject: string, instruction: string) => Promise<void>;
  emailFlow: ReturnType<typeof socialEmail>;
  rateLimit(
    scope: string,
    subject: string,
    policy: { limit: number; seconds: number },
  ): Promise<{ allowed: boolean; retryAfter: number }>;
  profile(
    id: string,
  ): Promise<
    { profile_color: number; profile_color_revision: number | string | bigint } | undefined
  >;
  recordAssurance(sessionId: string): Promise<void>;
  checkAssurance(
    sessionId: string,
    subject: string,
  ): Promise<{ valid: boolean; strongAt?: number }>;
  adapter: BetterAuthOptions["database"];
  allowSeed?: boolean;
}) {
  const { config, adapter, emailFlow, allowSeed = false } = options;
  const verifiedPasskeyRequests = new WeakSet<object>();
  if (allowSeed && (config.method !== "password" || !config.localPassword))
    throw new Error("Seeding requires local password mode");
  const sendVerification = !allowSeed ? options.accountMail : undefined;
  const service = betterAuth({
    baseURL: config.origin,
    secret: config.secret,
    database: adapter,
    trustedOrigins: [config.origin],
    onAPIError: { errorURL: `${config.origin}/login` },
    emailAndPassword: {
      enabled: config.method === "password",
      disableSignUp: !allowSeed && !config.registration,
      requireEmailVerification: !allowSeed,
      minPasswordLength: 8,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      ...(sendVerification
        ? {
            sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
              await sendVerification(
                user.email,
                url,
                accountEmails.reset.subject,
                accountEmails.reset.instruction,
              );
            },
          }
        : {}),
    },
    user: {
      changeEmail: {
        enabled: Boolean(sendVerification),
        ...(sendVerification
          ? {
              sendChangeEmailConfirmation: async ({
                user,
                url,
              }: {
                user: { email: string };
                url: string;
              }) => {
                await sendVerification(
                  user.email,
                  url,
                  accountEmails.change.subject,
                  accountEmails.change.instruction,
                );
              },
            }
          : {}),
      },
    },
    emailVerification: {
      sendOnSignUp: false,
      sendOnSignIn: false,
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
              const callback = new URL(
                verificationURL.searchParams.get("callbackURL") ?? "/",
                config.origin,
              );
              const changingEmail = callback.searchParams.has("emailChangePending");
              if (changingEmail || callback.pathname === "/")
                verificationURL.searchParams.set(
                  "callbackURL",
                  `${config.origin}/login?${changingEmail ? "emailChanged" : "verified"}=1`,
                );
              const content = changingEmail ? accountEmails.verify : accountEmails.registration;
              await sendVerification(
                user.email,
                verificationURL.toString(),
                content.subject,
                content.instruction,
              );
            },
          }
        : {}),
    },
    rateLimit: {
      enabled: !allowSeed,
      window: 60,
      max: 30,
      customStorage: {
        consume: async (key, rule) =>
          options.rateLimit("better-auth", key, { limit: rule.max, seconds: rule.window }),
      },
      customRules: {
        "/sign-up/email": { window: 60, max: 5 },
        "/send-verification-email": { window: 60, max: 3 },
      },
    },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        const session = ctx.context.newSession?.session;
        if (
          ctx.path === "/passkey/verify-authentication" &&
          ctx.request &&
          verifiedPasskeyRequests.has(ctx.request) &&
          session
        ) {
          await options.recordAssurance(session.id);
          verifiedPasskeyRequests.delete(ctx.request);
        }
      }),
      before: createAuthMiddleware(async (ctx) => {
        if (
          !allowSeed &&
          [
            "/change-email",
            "/link-social",
            "/unlink-account",
            "/passkey/generate-register-options",
            "/passkey/verify-registration",
            "/passkey/delete-passkey",
          ].includes(ctx.path)
        ) {
          const current = await getSessionFromCtx(ctx);
          if (!current) throw new APIError("UNAUTHORIZED", { message: "Sign in required" });
          const assurance = await options.checkAssurance(current.session.id, current.user.id);
          if (!assurance.valid || !sudoExpiresAt(assurance.strongAt, Math.floor(Date.now() / 1000)))
            throw new APIError("FORBIDDEN", {
              code: "STEP_UP_REQUIRED",
              message: "Confirm your identity to continue",
            });
        }

        let emailChangeToken = false;
        if (ctx.path === "/verify-email") {
          try {
            const token = String(ctx.query?.token ?? "");
            const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
            emailChangeToken = ["change-email-confirmation", "change-email-verification"].includes(
              payload.requestType,
            );
          } catch {
            /* The verifier rejects malformed signed links. */
          }
        }
        if (
          !allowSeed &&
          config.registration &&
          (["/sign-up/email", "/send-verification-email"].includes(ctx.path) ||
            (ctx.path === "/verify-email" && !emailChangeToken))
        )
          throw new APIError("FORBIDDEN", {
            message: "Verify your email through account setup first",
          });
        if (
          [
            "/update-user",
            "/change-email",
            "/request-password-reset",
            "/reset-password",
            "/change-password",
            "/set-password",
            "/link-social",
            "/unlink-account",
          ].includes(ctx.path) &&
          ctx.method === "POST" &&
          ctx.headers?.get("origin") !== config.origin
        )
          throw new APIError("FORBIDDEN", { message: "Invalid origin" });
        if (ctx.path === "/update-user") {
          for (const [key, schema] of [
            ["username", usernameSchema],
            ["displayUsername", usernameSchema],
            ["name", optionalNameSchema],
          ] as const) {
            if (Object.hasOwn(ctx.body ?? {}, key)) {
              const result = schema.safeParse(ctx.body[key]);
              if (!result.success)
                throw new APIError("BAD_REQUEST", { message: result.error.issues[0].message });
              ctx.body[key] = result.data;
            }
          }
        }
        if (["/reset-password", "/change-password", "/set-password"].includes(ctx.path)) {
          const result = passwordSchema.safeParse(ctx.body?.newPassword);
          if (!result.success)
            throw new APIError("BAD_REQUEST", { message: result.error.issues[0].message });
        }
        if (["/change-email", "/request-password-reset"].includes(ctx.path)) {
          const result = emailSchema.safeParse(ctx.body?.newEmail ?? ctx.body?.email);
          if (!result.success)
            throw new APIError("BAD_REQUEST", { message: "Enter a valid email address." });
          if (ctx.path === "/change-email") ctx.body.newEmail = result.data;
          else ctx.body.email = result.data;
          // Count requests even for unknown addresses, preserving identical public reset responses.
          for (const policy of [
            { limit: 1, seconds: 60 },
            { limit: 5, seconds: 3600 },
          ]) {
            const limit = await options.rateLimit(
              `account:requests:${ctx.path}:${policy.seconds}`,
              result.data,
              policy,
            );
            if (!limit.allowed) {
              throw new APIError(
                "TOO_MANY_REQUESTS",
                {
                  message: `Try again in ${limit.retryAfter} seconds.`,
                },
                { "Retry-After": String(limit.retryAfter) },
              );
            }
          }
        }
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
    account: {
      accountLinking: { enabled: true, disableImplicitLinking: true, allowDifferentEmails: true },
    },
    socialProviders: {
      ...(config.social.google
        ? {
            google: {
              ...config.social.google,
              getUserInfo: emailFlow.provider(google(config.social.google)),
            },
          }
        : {}),
      ...(config.social.apple
        ? {
            apple: {
              ...config.social.apple,
              getUserInfo: emailFlow.provider(apple(config.social.apple)),
            },
          }
        : {}),
      ...(config.social.github
        ? {
            github: {
              ...config.social.github,
              getUserInfo: emailFlow.provider(github(config.social.github)),
            },
          }
        : {}),
      ...(config.method === "cognito"
        ? {
            cognito: {
              clientId: config.clientId,
              clientSecret: config.clientSecret,
              domain: config.domain,
              region: config.region,
              userPoolId: config.userPoolId,
              getUserInfo: emailFlow.provider(
                cognito({
                  clientId: config.clientId,
                  clientSecret: config.clientSecret,
                  domain: config.domain,
                  region: config.region,
                  userPoolId: config.userPoolId,
                }),
              ),
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
              // Provider refreshes cannot replace a server-owned photo.
              const { image: _image, ...data } = user;
              return { data };
            }
          },
        },
      },
    },
    advanced: {
      useSecureCookies: new URL(config.origin).protocol === "https:",
      ipAddress: { ipAddressHeaders: ["x-quorem-peer-ip"] },
    },
    plugins: [
      lastLoginMethod({
        // Username login is supplied by a separate plugin; classify it with credentials.
        customResolveMethod: (ctx) => (ctx.path === "/sign-in/username" ? "email" : null),
      }),
      {
        id: "await-account-delivery",
        // Better Auth normally logs/swallow delivery errors; callers must receive failures.
        init: () => ({
          context: {
            runInBackgroundOrAwait: async (task: unknown) => {
              await task;
            },
          },
        }),
      },
      ...(config.passkey
        ? [
            passkey({
              rpID: new URL(config.origin).hostname,
              rpName: "Quorem",
              origin: config.origin,
              registration: { requireSession: true },
              authentication: {
                afterVerification: async ({ ctx, verification }) => {
                  if (
                    verification.verified &&
                    verification.authenticationInfo.userVerified &&
                    ctx.request
                  )
                    verifiedPasskeyRequests.add(ctx.request);
                },
              },
            }),
          ]
        : []),
      ...(config.method === "password" ? [username({ immutableUsername: false })] : []),
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
          definePayload: async ({ user, session }) => {
            const profile = await options.profile(user.id);
            const colorRevision = Number(profile?.profile_color_revision ?? 0);
            if (!Number.isSafeInteger(colorRevision))
              throw new Error("Profile revision exceeds safe integer range");
            return {
              color: profile?.profile_color ?? 0,
              colorRevision,
              emailVerified: user.emailVerified === true,
              image: user.image?.startsWith("/api/auth/profile-photos/") ? user.image : "",
              name:
                user.name ||
                ("username" in user && typeof user.username === "string" ? user.username : ""),
              sessionId: session.id,
            };
          },
        },
      }),
    ],
  });
  const handler = service.handler;
  service.handler = (request) => emailFlow.handle(request, handler);
  return service;
}
