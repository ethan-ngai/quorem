import { readFileSync } from "node:fs";

function requireRelease(env) {
  if (
    env.GITHUB_REF !== "refs/heads/feat/hono-migration" ||
    !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "")
  )
    throw new Error("Exact migration release required");
}

/** Validate release identity before choosing any staged operation. */
export function validateStageIntent(env, request) {
  requireRelease(env);
  if (env.GITHUB_EVENT_NAME === "workflow_dispatch") {
    if (
      !["plan", "stage"].includes(env.HONO_BOOTSTRAP_ACTION) ||
      env.HONO_RELEASE_SHA !== env.GITHUB_SHA
    )
      throw new Error("Exact stage request required");
    return env.HONO_BOOTSTRAP_ACTION;
  }
  if (
    env.GITHUB_EVENT_NAME !== "push" ||
    !request ||
    typeof request !== "object" ||
    Array.isArray(request) ||
    Object.keys(request).sort().join() !== "action,operation" ||
    !["plan", "stage"].includes(request.action) ||
    typeof request.operation !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(request.operation)
  )
    throw new Error("Explicit stage intent required");
  return request.action;
}

/** Read only the source-controlled push intent; manual input remains in the environment. */
export function stageIntent(env, read = readFileSync) {
  if (env.GITHUB_EVENT_NAME !== "push") return validateStageIntent(env);
  // Reject the wrong branch or revision before touching even the local intent file.
  requireRelease(env);
  let request;
  try {
    request = JSON.parse(read("deploy/hono/stage-request.json", "utf8"));
  } catch {
    throw new Error("Invalid stage intent file");
  }
  return validateStageIntent(env, request);
}
