/** @file client.ts @description Shared authenticated API transport and response handling. @module api */
import { createApiClient, type DevelopmentIdentity } from "@quorem/contracts";
import { authenticatedFetch } from "../features/auth/session";
import { UserFacingError } from "../ui/errors";
import { specificErrorMessage } from "./safeError";

const apiOrigin = () => import.meta.env.VITE_API_BASE_URL ?? window.location.origin;

/** Creates a same-origin client so local requests pass through Vite's API proxy. */
export const api = (identity: DevelopmentIdentity = "anonymous" as DevelopmentIdentity) =>
  createApiClient({
    baseUrl: apiOrigin(),
    identity,
    fetch: authenticatedFetch,
  });

/** Explicit public reads cannot inherit account or guest credentials. */
export const publicApi = () =>
  createApiClient({
    baseUrl: apiOrigin(),
    fetch: (input, init) => {
      const request = new Request(input, { ...init, credentials: "omit" });
      request.headers.delete("Authorization");
      request.headers.delete("Cookie");
      request.headers.delete("X-Dev-User");
      return fetch(request);
    },
  });

/** Turns typed API error responses into messages suitable for the workspace. */
export function requireData<T>(data: T | undefined, error: unknown): T {
  if (data !== undefined) return data;
  const detail = error && typeof error === "object" && "error" in error ? error.error : undefined;
  const code = detail && typeof detail === "object" && "code" in detail ? detail.code : undefined;
  const serverMessage =
    detail && typeof detail === "object" && "message" in detail ? detail.message : undefined;
  const safeMessages: Record<string, string> = {
    step_up_required: "Sign in with a verified passkey again before publishing.",
    entitlement_required: "This feature is not enabled for this account.",
    quota_exceeded: "Execution allowance reached. Please try again later.",
    rate_limited: "Too many requests. Try again shortly.",
    room_full: "This lobby is full.",
  };
  const message =
    typeof code === "string" && Object.hasOwn(safeMessages, code)
      ? (specificErrorMessage(code, serverMessage) ?? safeMessages[code])
      : "Request failed. Please try again.";
  throw new UserFacingError(message);
}
