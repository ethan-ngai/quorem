/** @file routes.ts @description Shared identity transport error mapping. @module identity */
import { ApplicationError } from "../../application/error.ts";
import { IdentityError, type Principal } from "./model.ts";
import { GuestOriginDenied } from "./guest/credentials.ts";
/** Resolve identity and translate expected authority failures for the shared HTTP handler. */
export async function identifyRequest(
  identify: (request: Request) => Promise<Principal | undefined>,
  request: Request,
): Promise<Principal | undefined> {
  try {
    return await identify(request);
  } catch (error) {
    if (error instanceof GuestOriginDenied)
      throw new ApplicationError("forbidden", "Origin denied", 403);
    if (error instanceof IdentityError)
      throw error.kind === "unauthorized"
        ? new ApplicationError("unauthenticated", "Invalid credentials", 401)
        : new ApplicationError("temporarily_unavailable", "Service unavailable", 503);
    throw error;
  }
}
