/** The signing key is bound to this Worker alone. */
import { createVerificationFetch } from "../verification/service.ts";
import { integer, key, origin, verificationSigningKey } from "./config.ts";

export default {
  async fetch(
    request: Request,
    env: NodeJS.ProcessEnv & {
      VERIFICATION_SOURCE?: { fetch(request: Request): Promise<Response> };
    },
  ): Promise<Response> {
    if (new URL(request.url).origin !== origin(env, "VERIFIER_ORIGIN"))
      return new Response(null, { status: 404 });
    const verify = createVerificationFetch({
      bundle: true,
      fetch: env.VERIFICATION_SOURCE
        ? (input, init) => env.VERIFICATION_SOURCE!.fetch(new Request(input, init))
        : undefined,
      sourceOrigin: origin(env, "QUOREM_VERIFICATION_SOURCE_ORIGIN"),
      sourceCredential: key(env, "QUOREM_VERIFICATION_SOURCE_KEY"),
      serviceCredential: key(env, "QUOREM_VERIFICATION_SERVICE_KEY"),
      signingKey: await verificationSigningKey(env.QUOREM_VERIFICATION_SIGNING_KEY_PEM ?? ""),
      timeoutMs: integer(env, "QUOREM_VERIFICATION_TIMEOUT_MS", 30000, 120000),
    });
    return verify(request);
  },
};
