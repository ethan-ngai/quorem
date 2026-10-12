import { Pool } from "pg";
import { configuration } from "./config.ts";
export const config = configuration(process.env);
export const database = new Pool({
  connectionString: config.database,
  options: "-c search_path=quorem_auth",
});
