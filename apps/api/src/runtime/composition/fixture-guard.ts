/** @file fixture-guard.ts @description Restrict destructive runtime fixtures to a named local database. @module runtime */
export function assertRuntimeFixture(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Disposable runtime database required");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/quorem_hono_runtime_test" ||
    url.hash ||
    [...url.searchParams.keys()].some((name) =>
      ["host", "hostaddr", "service"].includes(name.toLowerCase()),
    )
  )
    throw new Error("Disposable runtime database required");
}
