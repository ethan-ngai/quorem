import { Pool } from "pg";
import { databasePoolOptions } from "./databasePool.ts";
import { configuration } from "./config.ts";
export const config = configuration(process.env);
export const database = new Pool({
  ...databasePoolOptions(process.env),
  connectionString: config.database,
  options: "-c search_path=quorem_auth",
});
