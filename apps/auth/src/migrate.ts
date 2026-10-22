import { migrateAuth } from "./migrations.ts";
import { database } from "./database.ts";
try {
  await migrateAuth(database);
} finally {
  await database.end();
}
