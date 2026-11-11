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
  readonly details?: Readonly<Record<string, unknown>>;
  constructor(
    code: string,
    message: string,
    status: ApplicationStatus,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Diagnostics exclude messages, queries, URLs and values supplied by callers. */
export function failureSummary(error: unknown) {
  const causes: { kind: string; category?: string; code?: string; reason?: string }[] = [];
  const reasons = [
    ["io_context", /Cannot perform I\/O on behalf of a different request/i],
    ["connection_limit", /Too many open connections|maximum number of concurrent connections/i],
    ["subrequest_limit", /Too many API requests by single worker invocation/i],
    [
      "connection_lost",
      /Network connection lost|Connection terminated unexpectedly|Connection closed unexpectedly/i,
    ],
    [
      "connection_timeout",
      /timeout exceeded when trying to connect|Connection terminated due to connection timeout/i,
    ],
    ["unresolved_promise", /The script will never generate a response/i],
    ["platform_internal", /^internal error(?:;|$)/i],
  ] as const;
  const seen = new Set<unknown>();
  let current = error;
  while (current instanceof Error && !seen.has(current) && causes.length < 4) {
    seen.add(current);
    const code = "code" in current && typeof current.code === "string" ? current.code : "";
    const category = "kind" in current && typeof current.kind === "string" ? current.kind : "";
    const message = current.message;
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
      reason: reasons.find(([, pattern]) => pattern.test(message))?.[0],
      code: /^(?:08[0-9A-Z]{3}|2350[235]|23514|53[234]00|55P03|57014|40001|40P01|57P0[123]|XX000|ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT)$/.test(
        code,
      )
        ? code
        : undefined,
    });
    current = current.cause;
  }
  return { causes };
}
