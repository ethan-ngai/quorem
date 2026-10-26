/** Shares the route's deferred editor chunk with read-only pointer/focus preloading. */
export function loadWorkspacePage() {
  return import("./WorkspacePage").then((module) => ({ default: module.WorkspacePage }));
}

export function warmWorkspacePage() {
  void loadWorkspacePage().catch(() => {
    /* Navigation reports a failed chunk load. */
  });
}
