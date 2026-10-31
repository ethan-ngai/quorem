import { withWorkerConnection } from "@quorem/database/core";
import { configuration } from "./config.ts";
import { composeAuth } from "./composition.ts";
import { mailIntentKey } from "./mail-key.ts";
import { verificationMailer } from "./mailer.ts";
import { cloudflareEmail } from "./adapters/cloudflare-email.ts";
import type { VerificationSender } from "./email-delivery.ts";
import type { MailConfiguration } from "./platform-config.ts";

export interface AuthWorkerEnv {
  DB: { connectionString: string };
  [key: string]: unknown;
}

export function workerRuntime(
  env: AuthWorkerEnv,
  signal?: AbortSignal,
  transportFactory: (
    config: Extract<MailConfiguration, { driver: "cloudflare" }>,
  ) => VerificationSender = (config) => verificationMailer(cloudflareEmail(config)),
) {
  const values = Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  const config = configuration({ ...values, AUTH_DATABASE_URL: env.DB.connectionString });
  if (config.mail && config.mail.driver !== "cloudflare")
    throw new Error("Worker mail requires the configured HTTPS adapter");
  const transport = config.mail ? transportFactory(config.mail) : undefined;
  const run = <T>(callback: Parameters<typeof withWorkerConnection<T>>[2]) =>
    withWorkerConnection(
      env.DB.connectionString,
      { connectionTimeoutMs: 5000, lifetimeMs: 15000, signal },
      callback,
    );
  return composeAuth({
    config,
    run,
    transport,
    mailKey: transport ? mailIntentKey(values.AUTH_MAIL_INTENT_KEY) : undefined,
  });
}

export default {
  fetch(request: Request, env: AuthWorkerEnv) {
    return workerRuntime(env, request.signal).app.fetch(request);
  },
};
