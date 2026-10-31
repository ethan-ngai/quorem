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
    throw mapIdentityError(error);
  }
}
/** Translate identity failures at transport boundaries without exposing their causes. */
export function mapIdentityError(error: unknown): unknown {
  let mapped: ApplicationError | undefined;
  if (error instanceof GuestOriginDenied)
    mapped = new ApplicationError("forbidden", "Origin denied", 403);
  else if (error instanceof IdentityError)
    mapped =
      error.kind === "unauthorized"
        ? new ApplicationError("unauthenticated", "Invalid credentials", 401)
        : new ApplicationError("temporarily_unavailable", "Service unavailable", 503);
  if (!mapped) return error;
  Object.defineProperty(mapped, "cause", { value: error });
  return mapped;
}
