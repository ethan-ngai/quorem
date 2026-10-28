/** @file api.ts @description Authorized interview requests with safe errors and retry keys. @module interviews */
import { authenticatedFetch } from "../auth/session";
import { UserFacingError } from "../../ui/errors";
import { specificErrorMessage } from "../../api/safeError";

const messages: Record<string, string> = {
  admission_locked: "The host has locked this interview. Ask them to unlock it to join.",
  forbidden: "You no longer have access to this interview.",
  unauthenticated: "Open your invitation or sign in to continue.",
  entitlement_required: "This feature is not enabled for this account.",
  quota_exceeded: "A limit has been reached. Please try again later.",
  invalid_transition: "This interview changed. Refresh and try again.",
  rate_limited: "Too many requests. Try again shortly.",
  stale_version: "The shared document changed. Synchronizing…",
  stage_changed: "The stage changed. Try again after it refreshes.",
  invalid_input: "Check the question and test values, then try again.",
};

/** Keeps machine error codes for conflict recovery without displaying server internals. */
export class InterviewError extends UserFacingError {
  constructor(
    public readonly code: string,
    public readonly status: number,
    detail?: unknown,
  ) {
    super(
      specificErrorMessage(code, detail) ??
        (Object.hasOwn(messages, code)
          ? messages[code]
          : "Interview request failed. Your code is still here."),
    );
    this.useFallback = !specificErrorMessage(code, detail) && !Object.hasOwn(messages, code);
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
    const error = (await response.json().catch(() => undefined)) as
      | { error?: { code?: unknown; message?: unknown } }
      | null
      | undefined;
    const code = error?.error?.code;
    throw new InterviewError(
      typeof code === "string" ? code : "request_failed",
      response.status,
      error?.error?.message,
    );
  }
  return response.json() as Promise<T>;
}
