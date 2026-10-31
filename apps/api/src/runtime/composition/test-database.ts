/** Reject connection overrides before a destructive disposable-database fixture runs. */
export function assertRuntimeTestDatabase(value: string): void {
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/quorem_hono_runtime_test" ||
    ["host", "hostaddr", "service"].some((key) => url.searchParams.has(key))
  ) {
    throw new Error("Runtime tests require the disposable loopback database");
  }
}
