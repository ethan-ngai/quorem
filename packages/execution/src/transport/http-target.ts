/** @file http-target.ts @description Normalize private HTTP proxy request targets. @module execution */

/**
 * @description Accept origin-form and proxy absolute-form without reinterpreting relative paths.
 * @returns Origin-form path and query.
 * @throws When an absolute target is malformed or contains credentials.
 */
export function normalizeHttpTarget(target = "/"): string {
  if (!/^https?:\/\//i.test(target)) return target;
  const url = new URL(target);
  if (url.username || url.password) throw new Error("Invalid request target");
  return url.pathname + url.search;
}
