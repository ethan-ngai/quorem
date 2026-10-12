import { readFile } from "node:fs/promises";
import { database } from "./database.ts";
try {
  await database.query(
    await readFile(new URL("../migrations/001_auth.sql", import.meta.url), "utf8"),
  );
} finally {
  await database.end();
}
