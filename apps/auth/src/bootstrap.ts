/** @file bootstrap.ts @description Explicit production operator provisioning, never a public route. @module auth */
import { randomUUID } from "node:crypto";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { Pool } from "pg";
import { emailSchema, usernameSchema, passwordSchema } from "@quorem/contracts/auth";
import { seedProductUser } from "./seed-product-user.ts";
import { createNodeDatabase } from "./database.ts";

/** Provision one verified operator, refusing credential takeover or password rotation on retries. */
export async function bootstrap(env: NodeJS.ProcessEnv = process.env) {
  const { config, database } = createNodeDatabase(env);
  try {
    if (env.AUTH_BOOTSTRAP !== "true" || config.method !== "password")
      throw new Error("Operator bootstrap requires AUTH_BOOTSTRAP=true and password mode");
    const email = emailSchema.parse(env.AUTH_BOOTSTRAP_EMAIL);
    const username = usernameSchema.parse(env.AUTH_BOOTSTRAP_USERNAME);
    const password = passwordSchema.parse(env.AUTH_BOOTSTRAP_PASSWORD);
    if (password.length < 20)
      throw new Error("Bootstrap password must have at least 20 characters");
    const productURL = env.DATABASE_URL;
    if (!productURL) throw new Error("DATABASE_URL required");
    const product = new Pool({ connectionString: productURL });
    const client = await database.connect();
    let subject: string;
    try {
      const provisioned = await product.query(
        "SELECT a.scope AS subject,b.issuer FROM access_audit a LEFT JOIN identity_bindings b ON b.user_id=a.user_id AND b.subject=a.scope WHERE a.operation_id='bootstrap:operator'",
      );
      if (provisioned.rowCount) {
        const binding = provisioned.rows[0];
        if (provisioned.rowCount !== 1 || binding.issuer !== config.origin)
          throw new Error(
            "Operator bootstrap issuer differs; migrate the existing binding explicitly",
          );
        const current = await client.query('SELECT id,email,username FROM "user" WHERE id=$1', [
          binding.subject,
        ]);
        if (current.rowCount !== 1) throw new Error("Bootstrapped operator identity is missing");
        // Password/profile changes and revoked grants survive subsequent deployments.
        console.log(JSON.stringify({ ...current.rows[0], existing: true }));
        return;
      }
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(740179)");
      const existing = await client.query(
        'SELECT u.id,u.email,u.username,u."emailVerified",a.password FROM "user" u LEFT JOIN account a ON a."userId"=u.id AND a."providerId"=\'credential\' WHERE u.email=$1 OR lower(u.username)=lower($2)',
        [email, username],
      );
      if (existing.rowCount) {
        const user = existing.rows[0];
        if (
          existing.rowCount !== 1 ||
          user.email !== email ||
          user.username !== username ||
          !user.emailVerified ||
          !user.password ||
          !(await verifyPassword({ hash: user.password, password }))
        )
          throw new Error(
            "Existing operator identity or credential differs; bootstrap refuses takeover",
          );
        subject = user.id;
      } else {
        subject = randomUUID();
        await client.query(
          'INSERT INTO "user"(id,name,email,"emailVerified",username,"displayUsername","createdAt","updatedAt") VALUES($1,$2,$3,true,$4,$4,NOW(),NOW())',
          [subject, env.AUTH_BOOTSTRAP_NAME ?? username, email, username],
        );
        await client.query(
          'INSERT INTO account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2,\'credential\',$2,$3,NOW(),NOW())',
          [randomUUID(), subject, await hashPassword(password)],
        );
      }
      await client.query("COMMIT");
      const userId = await seedProductUser(product, {
        origin: config.origin,
        subject,
        name: env.AUTH_BOOTSTRAP_NAME ?? username,
        admin: true,
        source: "production-bootstrap",
        reference: `operator:${subject}`,
      });
      await product.query(
        "INSERT INTO access_audit(operation_id,actor,user_id,action,scope,reason) VALUES('bootstrap:operator','production-bootstrap',$1,'operator.bootstrap',$2,'Immutable initial operator binding') ON CONFLICT DO NOTHING",
        [userId, subject],
      );
      // Only metadata enters Actions logs; the password remains a repository secret.
      console.log(JSON.stringify({ userId, email, username }));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
      await product.end();
    }
  } finally {
    await database.end();
  }
}

if (import.meta.main) await bootstrap();
