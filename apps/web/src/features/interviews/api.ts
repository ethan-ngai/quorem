/** @file api.ts @description Authorized interview requests with safe errors and retry keys. @module interviews */
import { authenticatedFetch } from "../auth/session";
import { UserFacingError } from "../../ui/errors";

/** Keeps machine error codes for conflict recovery without displaying server internals. */
export class InterviewError extends UserFacingError {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

/** @returns Parsed authorized response; cookie credentials support invited guests. */
export async function interviewRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
  key?: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await authenticatedFetch(new URL(path, window.location.origin), {
    method,
    credentials: "same-origin",
    signal,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as { error?: { code?: string } };
    const code = error.error?.code ?? "request_failed";
    const messages: Record<string, string> = {
      forbidden: "You no longer have access to this interview.",
      unauthenticated: "Open your invitation or sign in to continue.",
      entitlement_required: "This feature is not enabled for this account.",
      rate_limited: "Too many requests. Try again shortly.",
      stale_version: "The shared document changed. Synchronizing…",
      invalid_input: "Check the question and test values, then try again.",
    };
    throw new InterviewError(
      code,
      messages[code] ?? "Interview request failed. Your code is still here.",
      response.status,
    );
  }
  return response.json() as Promise<T>;
}
