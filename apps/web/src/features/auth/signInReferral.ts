/** Keep back navigation within the page that opened auth, including its filters. */
export function signInReferral(search: string, referrer: string, origin: string): string | null {
  const valid = (path: string) =>
    !/[\\\r\n]/.test(path) &&
    (/^\/(\?|#|$)/.test(path) || /^\/(practice|match|invite|admin)(\/|\?|#|$)/.test(path));
  const requested = new URLSearchParams(search).get("returnTo");
  if (requested && valid(requested)) return requested;
  if (!referrer) return null;
  try {
    const source = new URL(referrer);
    if (source.origin !== origin) return null;
    const path = source.pathname + source.search + source.hash;
    return valid(path) ? path : null;
  } catch {
    return null;
  }
}
