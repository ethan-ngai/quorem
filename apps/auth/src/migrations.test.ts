import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { migrateAuth } from "./migrations";

const url = process.env.AUTH_TEST_DATABASE_URL;
describe.skipIf(!url)("auth schema migrations", () => {
  it("serializes concurrent startup, skips applied SQL and preserves unknown history", async () => {
    const database = new Pool({ connectionString: url });
    try {
      await Promise.all([migrateAuth(database), migrateAuth(database)]);
      const before = await database.query('SELECT count(*) FROM quorem_auth."user"');
      await migrateAuth(database);
      expect((await database.query('SELECT count(*) FROM quorem_auth."user"')).rows).toEqual(
        before.rows,
      );
      expect(
        (await database.query("SELECT name FROM quorem_auth.schema_migrations ORDER BY name")).rows,
      ).toEqual([
        { name: "001_schema.sql" },
        { name: "002_profile_color.sql" },
        { name: "003_account_user_index.sql" },
        { name: "004_social_email_expiry.sql" },
        { name: "005_mail_intents.sql" },
        { name: "006_profile_budgets.sql" },
      ]);
      await database.query("DELETE FROM quorem_auth.schema_migrations WHERE name='001_schema.sql'");
      await expect(migrateAuth(database)).rejects.toThrow("not a contiguous prefix");
      await database.query("INSERT INTO quorem_auth.schema_migrations VALUES('001_schema.sql')");
      await database.query("INSERT INTO quorem_auth.schema_migrations VALUES('unavailable.sql')");
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
        "INSERT INTO quorem_auth.schema_migrations VALUES('001_schema.sql') ON CONFLICT DO NOTHING",
      );
      await database.query(
        "DELETE FROM quorem_auth.schema_migrations WHERE name='unavailable.sql'",
      );
      await database.end();
    }
  });
});
