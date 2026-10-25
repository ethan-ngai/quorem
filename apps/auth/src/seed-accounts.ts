import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createAuth, config, database } from "./auth.ts";

export async function seedAccounts(password: string, productURL?: string) {
  if (config.method !== "password" || !config.localPassword)
    throw new Error("Seeding requires local password mode");
  for (const value of [config.database, ...(productURL ? [productURL] : [])]) {
    if (!["localhost", "127.0.0.1"].includes(new URL(value).hostname))
      throw new Error("Seeding requires loopback databases");
  }
  if (password.length < 12 || password.length > 128)
    throw new Error("AUTH_SEED_PASSWORD must contain 12-128 characters");
  const seedAuth = createAuth(true);
  const product = productURL ? new Pool({ connectionString: productURL }) : undefined;
  const accounts: { username: string; subject: string }[] = [];
  try {
    for (const name of ["Alice", "Bob"]) {
      const username = name.toLowerCase();
      const existing = await database.query('SELECT id,email FROM "user" WHERE username=$1', [
        username,
      ]);
      let subject: string;
      if (existing.rowCount) {
        if (existing.rows[0].email !== `${username}@quorem.local`)
          throw new Error("Seed username already belongs to another account");
        subject = existing.rows[0].id;
        const verification = await seedAuth.api.signInUsername({ body: { username, password } });
        // Verification creates a session; discard it before returning seed metadata.
        await database.query('DELETE FROM "session" WHERE token=$1', [verification.token]);
      } else {
        const response = await seedAuth.handler(
          new Request(`${config.origin}/api/auth/sign-up/email`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Origin: config.origin },
            body: JSON.stringify({ username, email: `${username}@quorem.local`, name, password }),
          }),
        );
        if (!response.ok) throw new Error(`Unable to seed ${username}: HTTP ${response.status}`);
        subject = ((await response.json()) as { user: { id: string } }).user.id;
      }
      await database.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [subject]);
      if (product) {
        const client = await product.connect();
        try {
          await client.query("BEGIN");
          const binding = await client.query(
            "SELECT user_id FROM identity_bindings WHERE issuer=$1 AND subject=$2",
            [config.origin, subject],
          );
          const id = binding.rows[0]?.user_id ?? randomUUID();
          if (!binding.rowCount) {
            await client.query(
              "INSERT INTO users(id,participant_id,display_name) VALUES($1::text,$1::text::uuid,$2)",
              [id, name],
            );
            await client.query(
              "INSERT INTO identity_bindings(issuer,subject,user_id) VALUES($1,$2,$3)",
              [config.origin, subject, id],
            );
          }
          await client.query("UPDATE users SET role=$2 WHERE id=$1", [
            id,
            username === "alice" ? "admin" : "user",
          ]);
          if (username === "alice") {
            await client.query(
              "INSERT INTO entitlement_grants(id,user_id,feature,source,source_ref,actor,reason) VALUES($1,$2,'internal','internal','local:alice','local-seed','Local internal-plan fixture') ON CONFLICT(user_id,feature,source,source_ref) DO NOTHING",
              [randomUUID(), id],
            );
            await client.query(
              "INSERT INTO access_audit(operation_id,actor,user_id,action,scope,reason) VALUES($1,'local-seed',$2,'seed:internal','internal','Loopback-only Alice fixture') ON CONFLICT DO NOTHING",
              [`seed:internal:${id}`, id],
            );
          }
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }
      accounts.push({ username, subject });
    }
    return accounts;
  } finally {
    await product?.end();
  }
}
