/** @file error.ts @description Expected application failures. @module api */
export type ApplicationStatus =
  | 400
  | 401
  | 403
  | 404
  | 409
  | 410
  | 413
  | 422
  | 429
  | 500
  | 502
  | 503
  | 504;

export class ApplicationError extends Error {
  readonly code: string;
  readonly status: ApplicationStatus;
  constructor(code: string, message: string, status: ApplicationStatus) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Diagnostics exclude messages, queries, URLs and values supplied by callers. */
export function failureSummary(error: unknown) {
  const causes: { kind: string; category?: string; code?: string }[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current instanceof Error && !seen.has(current) && causes.length < 4) {
    seen.add(current);
    const code = "code" in current && typeof current.code === "string" ? current.code : "";
    const category = "kind" in current && typeof current.kind === "string" ? current.kind : "";
    causes.push({
      kind: [
        "Error",
        "DatabaseFailure",
        "ApplicationError",
        "IdentityError",
        "AbortError",
        "TimeoutError",
        "TypeError",
        "RangeError",
      ].includes(current.name)
        ? current.name
        : "Error",
      category: [
        "unavailable",
        "connection",
        "lock_timeout",
        "query_cancelled",
        "serialization",
        "deadlock",
        "aborted",
        "unknown_commit",
      ].includes(category)
        ? category
        : undefined,
      code: /^(?:08[0-9A-Z]{3}|2350[235]|23514|55P03|57014|40001|40P01|57P0[123])$/.test(code)
        ? code
        : undefined,
    });
    current = current.cause;
  }
  return { causes };
}
