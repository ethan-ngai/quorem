import { Pool } from "pg";
import { databasePoolOptions } from "./databasePool.ts";
import { configuration } from "./config.ts";

export function createNodeDatabase(env: NodeJS.ProcessEnv) {
  const config = configuration(env);
  const database = new Pool({
    ...databasePoolOptions(env),
    connectionString: config.database,
    options: "-c search_path=quorem_auth",
  });
  return { config, database };
}
