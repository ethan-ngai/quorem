import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { migrateAuth } from "./migrations";

const url = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!url)("auth schema migrations", () => {
  it("serializes concurrent startup, skips applied SQL and preserves unknown history", async () => {
    const database = new Pool({ connectionString: url });
    let firstChecksum: string | undefined;
    try {
      await Promise.all([migrateAuth(database), migrateAuth(database)]);
      const before = await database.query('SELECT count(*) FROM quorem_auth."user"');
      await migrateAuth(database);
      expect((await database.query('SELECT count(*) FROM quorem_auth."user"')).rows).toEqual(
        before.rows,
      );
      expect(
        (await database.query("SELECT name FROM quorem_auth.schema_migrations ORDER BY name")).rows,
      ).toEqual([{ name: "007_baseline.sql" }]);
      firstChecksum = (
        await database.query(
          "SELECT checksum FROM quorem_auth.schema_migrations WHERE name='007_baseline.sql'",
        )
      ).rows[0].checksum;
      await database.query(
        "UPDATE quorem_auth.schema_migrations SET checksum='invalid' WHERE name='007_baseline.sql'",
      );
      await expect(migrateAuth(database)).rejects.toThrow("checksum mismatch");
      await database.query(
        "UPDATE quorem_auth.schema_migrations SET checksum=$1 WHERE name='007_baseline.sql'",
        [firstChecksum],
      );
      await database.query(
        "INSERT INTO quorem_auth.schema_migrations(name) VALUES('unavailable.sql')",
      );
      await expect(migrateAuth(database)).rejects.toThrow("unavailable auth migration");
      expect(
        (
          await database.query(
            "SELECT name FROM quorem_auth.schema_migrations WHERE name='unavailable.sql'",
          )
        ).rowCount,
      ).toBe(1);
    } finally {
      await database.query(
        "UPDATE quorem_auth.schema_migrations SET checksum=$1 WHERE name='007_baseline.sql' AND checksum='invalid'",
        [firstChecksum ?? null],
      );
      await database.query(
        "DELETE FROM quorem_auth.schema_migrations WHERE name='unavailable.sql'",
      );
      await database.end();
    }
  });
});
