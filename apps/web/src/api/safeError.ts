const specificMessages: Record<string, Record<string, string>> = {
  entitlement_required: {
    "Guest hosting requires an eligible plan":
      "Guest hosting requires an eligible plan or internal access.",
    "Guest hosting is unavailable": "Guest hosting requires an eligible plan or internal access.",
    "Interview hosting is unavailable": "Interview hosting is not enabled for this account.",
    "Interview access is disabled": "The host's interview access is no longer enabled.",
  },
  quota_exceeded: {
    "End an interview before creating another": "End an active interview before creating another.",
    "Guest admission limit reached": "This interview has reached its guest admission limit.",
    "Too many editor windows": "Close another editor window and try again.",
    "Host guest execution capacity reached":
      "The host's guest execution capacity is full. Try again shortly.",
    "Execution quota reached": "Execution allowance reached. Please try again later.",
  },
  rate_limited: {
    "Another guest execution is active; try again shortly":
      "Another guest run is active. Try again shortly.",
  },
};

/** Only display explicitly approved server details. */
export function specificErrorMessage(code: string, detail: unknown): string | undefined {
  if (typeof detail !== "string" || !Object.hasOwn(specificMessages, code)) return undefined;
  const messages = specificMessages[code];
  return Object.hasOwn(messages, detail) ? messages[detail] : undefined;
}
