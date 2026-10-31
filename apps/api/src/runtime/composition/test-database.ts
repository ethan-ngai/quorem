/** Reject connection overrides before a destructive disposable-database fixture runs. */
export function assertRuntimeTestDatabase(value: string): void {
  const url = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/quorem_hono_runtime_test" ||
    !!url.hash ||
    [...url.searchParams.keys()].some((key) =>
      ["host", "hostaddr", "service"].includes(key.toLowerCase()),
    )
  ) {
    throw new Error("Runtime tests require the disposable loopback database");
  }
}
