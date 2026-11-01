/** @file grant.ts @description Bind verified credentials to live socket authority. @module events */
import {
  reauthorizeGrant,
  type GrantReaders,
  type VerifiedGrant,
} from "../../../modules/identity/grant.ts";
import type { Principal } from "../../../modules/identity/model.ts";
import type { SocketSecurity } from "../../../modules/events/socket/ports.ts";
/** The grant contains verified identifiers or token hashes, never bearer or cookie bytes. */
export function grantSecurity(
  grant: VerifiedGrant,
  readers: GrantReaders,
  authorize: (principal: Principal | undefined, signal: AbortSignal) => Promise<string>,
): SocketSecurity {
  const binding = crypto.randomUUID(),
    bound = Object.freeze({ ...grant });
  return {
    verify: async (signal) => ({
      principal: await reauthorizeGrant(bound, readers, Date.now(), signal),
      binding,
      expiresAt: bound.expiresAt * 1000,
    }),
    authorize,
  };
}
