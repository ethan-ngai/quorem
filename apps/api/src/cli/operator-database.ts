/** Explicit TLS and routing prevent a resume cursor crossing databases. */
export function operatorDatabaseIdentity(value: string): readonly string[] {
  const url = new URL(value);
  const params = [...url.searchParams.entries()];
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    !url.pathname ||
    url.pathname === "/" ||
    url.hash ||
    params.length !== 1 ||
    params[0][0] !== "sslmode" ||
    !["verify-full", ...(local ? ["disable"] : [])].includes(params[0][1])
  )
    throw new Error("Operator database requires explicit safe routing and TLS");
  return [url.protocol, url.hostname, url.port || "5432", url.pathname, params[0][1]];
}
