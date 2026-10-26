import { describe, expect, it } from "vitest";
import { databasePoolOptions } from "./databasePool";
describe("elastic auth database budget", () => {
  it("bounds default and configured replicas without retaining idle connections", () => {
    expect(databasePoolOptions({})).toEqual({ max: 4, min: 0, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
    expect(databasePoolOptions({ AUTH_DATABASE_MAX_CONNS: "2" }).max).toBe(2);
  });
  it.each(["0", "65", "2.5", "oops"])("rejects invalid limit %s", (value) => {
    expect(() => databasePoolOptions({ AUTH_DATABASE_MAX_CONNS: value })).toThrow();
  });
});
