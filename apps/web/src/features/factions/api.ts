/** @file api.ts @description Authenticated team requests with stable command identities. @module factions */
import { authenticatedFetch } from "../auth/session";
import { randomUUID } from "../../randomUUID";
export class TeamError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function teamRequest<T>(
  id: string,
  action?: string,
  body?: unknown,
  key = randomUUID(),
): Promise<T> {
  const response = await authenticatedFetch(
    new URL(
      `/v1/matches/${encodeURIComponent(id)}/team${action ? `/${action}` : ""}`,
      import.meta.env.VITE_API_BASE_URL ?? window.location.origin,
    ),
    {
      method: action ? "POST" : "GET",
      headers: action ? { "Content-Type": "application/json", "Idempotency-Key": key } : undefined,
      body: action ? JSON.stringify(body ?? {}) : undefined,
    },
  );
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as {
      code?: string;
      message?: string;
      error?: { code?: string; message?: string };
    };
    throw new TeamError(
      error.code ?? error.error?.code ?? "unavailable",
      error.message ?? error.error?.message ?? "Team action failed",
    );
  }
  return response.json() as Promise<T>;
}
