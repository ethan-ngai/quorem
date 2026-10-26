import type { configuration } from "./config.ts";

/** Allowlist shared by local auth and deployment's public edge binding. */
export function publicAuthConfiguration(config: ReturnType<typeof configuration>) {
  return {
    method: config.method,
    hostedSignIn: config.method !== "password",
    preferredOrigin: config.origin,
    passkey: config.passkey,
    registration: config.registration,
    providers: Object.entries(config.social)
      .filter(([, value]) => value)
      .map(([name]) => name),
  };
}
