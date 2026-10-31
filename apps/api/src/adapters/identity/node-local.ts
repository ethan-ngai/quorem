import { isIP } from "node:net";
import { bearer } from "../../modules/identity/credentials.ts";
import { IdentityError, type LocalPrincipal } from "../../modules/identity/model.ts";

export async function nodeLocalIdentity(
  headers: Headers,
  remoteAddress: string | undefined,
  lookup: (userId: string) => Promise<LocalPrincipal>,
): Promise<LocalPrincipal> {
  if (bearer(headers) !== undefined) throw new IdentityError("unauthorized");
  const address = remoteAddress?.toLowerCase() ?? "";
  const ipv4 = address.startsWith("::ffff:") ? address.slice(7) : address;
  if (!(address === "::1" || (isIP(ipv4) === 4 && ipv4.split(".")[0] === "127")))
    throw new IdentityError("unauthorized");
  const user = headers.get("x-dev-user") || "alice";
  if (!["alice", "bob", "charlie", "dana"].includes(user)) throw new IdentityError("unauthorized");
  return lookup(user);
}
