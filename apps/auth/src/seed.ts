import { database } from "./database.ts";
import { seedAccounts } from "./seed-accounts.ts";
try {
  console.log(
    JSON.stringify(
      await seedAccounts(process.env.AUTH_SEED_PASSWORD ?? "", process.env.DATABASE_URL),
    ),
  );
} finally {
  await database.end();
}
