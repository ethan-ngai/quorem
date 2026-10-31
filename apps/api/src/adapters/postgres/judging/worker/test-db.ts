/** Disposable fixture names only; connection query parameters cannot replace the loopback host. */
export function assertRunnerFixture(raw: string, allowed: readonly string[]): void {
  const parsed = new URL(raw);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
    !allowed.includes(parsed.pathname) ||
    [...parsed.searchParams.keys()].some((key) =>
      ["host", "hostaddr", "service"].includes(key.toLowerCase()),
    )
  )
    throw new Error("Disposable runner database required");
}
