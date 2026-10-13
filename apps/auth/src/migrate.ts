import { readFile } from "node:fs/promises";
import { database } from "./database.ts";
try {
  for (const file of ["001_auth.sql", "002_username.sql"]) {
    await database.query(await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
} finally {
  await database.end();
}
