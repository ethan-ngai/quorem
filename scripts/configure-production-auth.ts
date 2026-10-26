import { appendFileSync } from "node:fs";
import { publicAuthConfiguration } from "../apps/auth/src/public-config.ts";
import {
  productionAuthEnvironment,
  productionAuthConfiguration,
} from "../apps/auth/src/production-config.ts";
import { platformConfiguration } from "../apps/auth/src/platform-config.ts";
import { smtpEmail } from "../apps/auth/src/adapters/smtp-email.ts";

const runtime = productionAuthEnvironment(process.env);
if (!process.env.GITHUB_ENV) throw new Error("GITHUB_ENV required");
const mail = platformConfiguration(runtime).mail;
if (mail && (mail.driver === "smtp" || mail.driver === "ses-smtp")) await smtpEmail(mail).verify();
// Only the protected Actions environment receives secret values; never stdout.
appendFileSync(process.env.GITHUB_ENV, `TF_VAR_auth_environment=${JSON.stringify(runtime)}\n`);
appendFileSync(
  process.env.GITHUB_ENV,
  `TF_VAR_auth_public_config=${JSON.stringify(publicAuthConfiguration(productionAuthConfiguration(process.env, runtime)))}\n`,
);
console.log(
  `Auth configuration validated: email=${runtime.AUTH_LOGIN_ONLY === "false"}; providers=${["GOOGLE", "GITHUB"].filter((name) => runtime[`${name}_CLIENT_ID`]).join(",") || "none"}`,
);
