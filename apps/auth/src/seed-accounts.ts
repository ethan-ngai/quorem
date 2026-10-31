import { Pool } from "pg";
import { seedProductUser } from "./seed-product-user.ts";
import type { createNodeRuntime } from "./node-auth.ts";

export async function seedAccounts(
  runtime: Awaited<ReturnType<typeof createNodeRuntime>>,
  password: string,
  productURL?: string,
) {
  const { createAuth, config, database } = runtime;
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
      if (product)
        await seedProductUser(product, {
          origin: config.origin,
          subject,
          name,
          admin: username === "alice",
          source: "local-seed",
          reference: `local:${username}`,
        });
      accounts.push({ username, subject });
    }
    return accounts;
  } finally {
    await product?.end();
  }
}
