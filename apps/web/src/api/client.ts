/** @file client.ts @description Shared authenticated API transport and response handling. @module api */
import { createApiClient, type DevelopmentIdentity } from "@quorem/contracts";
import { authenticatedFetch } from "../features/auth/session";
import { UserFacingError } from "../ui/errors";
import { safeErrorMessage } from "./safeError";

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

/** Retains machine-readable recovery codes while displaying sanitized messages. */
export class ApiError extends UserFacingError {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** Turns typed API error responses into messages suitable for the workspace. */
export function requireData<T>(data: T | undefined, error: unknown, status?: number): T {
  if (data !== undefined) return data;
  const detail = error && typeof error === "object" && "error" in error ? error.error : undefined;
  const code = detail && typeof detail === "object" && "code" in detail ? detail.code : undefined;
  const serverMessage =
    detail && typeof detail === "object" && "message" in detail ? detail.message : undefined;
  const message = safeErrorMessage(code, serverMessage);
  if (message || status !== undefined)
    throw new ApiError(
      message ?? "API request failed",
      typeof code === "string" ? code : "unknown",
      status,
    );
  throw new Error("API request failed");
}
