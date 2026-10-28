const specificMessages: Record<string, Record<string, string>> = {
  temporarily_unavailable: {
    "No questions match the selected filters":
      "No questions match these filters. Change the filters before starting.",
  },
  invalid_transition: {
    "All players must be ready": "Everyone must be ready before the match can start.",
    "Too many players for this mode": "Remove players or choose a mode that supports everyone.",
    "Remove guests before disabling guest access": "Remove guests before turning off guest access.",
    "Match settings are fixed": "The match has started, so its settings can no longer be changed.",
    "End the interview before deleting it": "End the interview before deleting it.",
    "Execution already finished": "This run has already finished.",
    "Match has started or closed": "This match has already started or closed.",
    "Interview is closed": "This interview has ended.",
    "Lobby admission is locked": "The host has locked this lobby.",
  },
  user_busy: {
    "Another match is active":
      "You already have an active match. Return to it or leave before starting another.",
    "Another execution is active": "A run is already in progress. Wait for it to finish.",
    "Wait for the current execution before switching languages":
      "Wait for the current run to finish before switching languages.",
  },
  revision_conflict: {
    "Draft changed or already published; reload it":
      "This draft changed or was published. Reload it before continuing.",
    "Odyssey level changed; reload progress": "Your Odyssey progress changed. Reload to continue.",
    "Wait for judging to finish before resetting progress":
      "Wait for judging to finish before resetting progress.",
  },
  document_changed: {
    "Document changed; synchronize and retry":
      "The document changed. Wait for it to sync, then try again.",
    "Question changed; open its current document":
      "The question changed. Open its current document and try again.",
    "Question changed; refresh before passing a stage":
      "The question changed. Refresh before advancing the stage.",
    "Question changed; refresh test cases":
      "The question changed. Refresh the test cases and try again.",
  },
  queue_saturated: {
    "Judge queue is full": "The judge is busy. Try running your code again shortly.",
  },
  invalid_input: {
    "slug, title and statement required": "Add a slug, title and statement before publishing.",
    "attribution required": "Add attribution before publishing.",
    "public examples and at least one hidden case required":
      "Add a public example and at least one hidden test before publishing.",
    "Python implementation required for coding problems":
      "Add a Python implementation before publishing.",
    "SQL problems require the PostgreSQL implementation":
      "Add a PostgreSQL implementation before publishing.",
    "question content exceeds 2 MiB": "Reduce the question content to less than 2 MiB.",
    "question collection limit exceeded": "Reduce the number of items in the question.",
    "question text limit exceeded": "Shorten the question text.",
    "language source limit exceeded": "Shorten the language source code.",
    "invalid or duplicate tag": "Check the topics and remove any duplicates.",
    "invalid or duplicate company": "Check the companies and remove any duplicates.",
    "invalid or duplicate parameter": "Check the parameters and remove any duplicates.",
    "Solution class and valid method name required":
      "Use the Solution class and provide a valid method name.",
    "execution limits exceed supported bounds": "Adjust the execution limits to supported values.",
    "SQL input and output schema required": "Add the SQL input and output schemas.",
    "invalid SQL dialect or output order": "Choose a supported SQL dialect and output order.",
    "Odyssey requires 1 to 8 levels with a private suite per level":
      "Add 1–8 Odyssey levels, each with private tests.",
    "SQL Odyssey requires 1 to 8 levels with private suites":
      "Add 1–8 SQL Odyssey levels, each with private tests.",
    "invalid Odyssey method": "Check the Odyssey method names and signatures.",
    "duplicate Odyssey method": "Remove duplicate Odyssey methods.",
    "Language unavailable for this question": "This language is not available for this question.",
    "Language unavailable for this problem": "This language is not available for this question.",
    "Language is unavailable for this problem": "This language is not available for this question.",
    "No tests configured": "Add a test case before running your code.",
    "Choose a new slug for global publication":
      "Choose a different slug before publishing globally.",
    "LeetCode ID is already in use": "That LeetCode ID is already used by another question.",
    "Choose an interview title up to 120 characters":
      "Choose an interview title with at most 120 characters.",
    "Choose a name between 1 and 40 characters": "Choose a name between 1 and 40 characters.",
    "Custom SQL interviews require a published SQL question":
      "Choose a published SQL question for a SQL interview.",
    "Provide 1-20 public tests and at most 100 private tests":
      "Add 1–20 public tests and at most 100 private tests.",
    "Invalid match settings": "Check the match settings and try again.",
    "Problem not found": "That question is no longer available. Choose another.",
  },
  not_found: {
    "Match not found": "This match is no longer available.",
    "Invitation unavailable": "This invitation is no longer available.",
    "Invite not found": "This invitation is no longer available.",
    "Question draft not found": "This draft is no longer available.",
    "Question unavailable": "This question is no longer available.",
    "Submission not found": "This submission is no longer available.",
    "Test case unavailable": "This test case is no longer available.",
  },
  immutable_version: {
    "Publish a new version to change editorial content":
      "Create a new question version to change its editorial.",
    "Publish a new version to change language artifacts":
      "Create a new question version to change its language setup.",
  },
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

const codeMessages: Record<string, string> = {
  no_matching_questions: "No questions match these filters. Change the filters before starting.",
  guest_hosting_paused: "Guest hosting is paused. Turn off Allow guests to continue.",
  step_up_required: "Sign in with a verified passkey again before publishing.",
  entitlement_required: "This feature is not enabled for this account.",
  quota_exceeded: "A limit has been reached. Please try again later.",
  rate_limited: "Too many requests. Try again shortly.",
  room_full: "This lobby is full.",
  unauthenticated: "Sign in again to continue.",
};

export function safeErrorMessage(code: unknown, detail: unknown): string | undefined {
  if (typeof code !== "string") return undefined;
  return (
    specificErrorMessage(code, detail) ??
    (Object.hasOwn(codeMessages, code) ? codeMessages[code] : undefined)
  );
}
