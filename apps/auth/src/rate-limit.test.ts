import { Pool } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { migrateAuth } from "./migrations";
import { withNodeConnection } from "@quorem/database/core";
import { drizzleAuthRepository } from "./adapters/drizzle-auth-repository";
const databaseURL = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!databaseURL)("shared persistent rate limiter", () => {
  it("atomically bounds concurrent requests, isolates scopes, survives callers and resets expired windows", async () => {
    const database = new Pool({
      connectionString: databaseURL,
      options: "-c search_path=quorem_auth",
    });
    await migrateAuth(database);
    const repository = drizzleAuthRepository((callback) =>
      withNodeConnection(database, { lifetimeMs: 10000 }, callback),
    );
    const subject = randomUUID();
    try {
      const policy = { limit: 3, seconds: 60 };
      const results = await Promise.all(
        Array.from({ length: 12 }, () => repository.rateLimit("test", subject, policy)),
      );
      expect(results.filter((r) => r.allowed)).toHaveLength(3);
      expect(
        results.filter((r) => !r.allowed).every((r) => r.retryAfter > 0 && r.retryAfter <= 60),
      ).toBe(true);
      expect((await repository.rateLimit("other", subject, policy)).allowed).toBe(true);
      const separate = new Pool({
        connectionString: databaseURL,
        options: "-c search_path=quorem_auth",
      });
      try {
        const other = drizzleAuthRepository((callback) =>
          withNodeConnection(separate, { lifetimeMs: 10000 }, callback),
        );
        expect((await other.rateLimit("test", subject, policy)).allowed).toBe(false);
      } finally {
        await separate.end();
      }
      await database.query(
        "UPDATE rate_limit SET expires_at=NOW()-interval '1 second' WHERE bucket=$1",
        [
          createHash("sha256")
            .update(JSON.stringify(["test", subject]))
            .digest("hex"),
        ],
      );
      expect((await repository.rateLimit("test", subject, policy)).allowed).toBe(true);
    } finally {
      await database.end();
    }
  });
});
