/** @returns Whether an account route can be restored after sign-in. */
export function isSignInReturnPath(path: string) {
  return (
    !/[\\\r\n]/.test(path) &&
    /^\/(home|practice|match|party|invite|admin|questions|interviews|interview|interview-invite)(\/|\?|#|$)/.test(
      path,
    )
  );
}

/** Keep back navigation within the page that opened auth, including its filters. */
export function signInReferral(search: string, referrer: string, origin: string): string | null {
  const valid = (path: string) =>
    /^\/(\?|#|$)/.test(path) ? !/[\\\r\n]/.test(path) : isSignInReturnPath(path);
  const withoutCreation = (path: string) => {
    const destination = new URL(path, origin);
    if (destination.searchParams.get("create") === "match")
      destination.searchParams.delete("create");
    return destination.pathname + destination.search + destination.hash;
  };
  const params = new URLSearchParams(search);
  const requested = params.get("backTo") ?? params.get("returnTo");
  if (requested && valid(requested)) return withoutCreation(requested);
  if (!referrer) return null;
  try {
    const source = new URL(referrer);
    if (source.origin !== origin) return null;
    const path = source.pathname + source.search + source.hash;
    return valid(path) ? withoutCreation(path) : null;
  } catch {
    return null;
  }
}
